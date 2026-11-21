/**
 * The event schedule, read and written against `/api/timeline`.
 *
 * WHAT WAS WRONG
 *   This service used the `events.timeline_blocks` JSON column, on the stated
 *   grounds that "the /api/timeline table endpoint reads the separate
 *   timeline_blocks TABLE which nothing populates". That was true when it was
 *   written and is not true now, and the consequence was data loss:
 *
 *     - `server/lib/event-dto.ts:146-164` is an allowlist, and
 *       `timeline_blocks` is deliberately absent from it, because a JSON blob
 *       cannot express `guest_visible` and was handing host-only notes to
 *       guests. So `GET /api/events/:id` stopped returning the column.
 *     - The read here therefore always produced `[]`.
 *     - Every write was a read-modify-write on top of that `[]`, so adding one
 *       block replaced the whole schedule with a single entry.
 *
 *   Meanwhile the column is read by nothing at all: the stats badge counts
 *   `prisma.timelineBlock` (`server/routes/events.ts:52`), which is the TABLE.
 *   A web-created schedule was invisible even to its own event's block count.
 *
 * WHAT IS TRUE NOW
 *   The table is the store. Mobile writes it (`api.timeline.create`), the
 *   stats count it, and the route applies `guest_visible` per block on read,
 *   which is the thing the JSON column could never do. The web now uses it
 *   too, so there is one schedule rather than two.
 *
 *   The read-modify-write helpers (`addTimelineBlock`, `updateTimelineBlock`,
 *   `deleteTimelineBlock`, `getPublicTimeline`) are gone rather than repaired.
 *   They had no callers outside this file, and that pattern was the defect;
 *   the table endpoints address a block by id, so nothing needs to read the
 *   whole schedule in order to change one row.
 *
 * TIME IS HANDLED IN UTC, DELIBERATELY
 *   The UI works in `"HH:MM"` and the column is a `DateTime`. Anchoring with
 *   local-timezone accessors would make a block saved at 19:00 read back as
 *   18:00 or 20:00 depending on the reader's offset, and the drift would look
 *   like a server bug. Both directions use UTC, so the round trip is exact.
 */

import { apiGet, apiPost, apiDelete } from './api-client';
import type { TimelineBlock } from '@/features/timeline/types';

/** A row of the `timeline_blocks` table, as `/api/timeline/:eventId` returns it. */
interface TimelineRow {
  id: string;
  label: string;
  description: string | null;
  start_time: string;
  duration: number;
  type: TimelineBlock['type'];
  guest_visible: boolean;
  notify_before: number | null;
  order_index: number;
}

/** `"HH:MM"` from an ISO instant, in UTC. See the note in the module header. */
function isoToClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '00:00';
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * An ISO instant from a `"YYYY-MM-DD"` anchor and a `"HH:MM"` clock time.
 *
 * @param anchorDate The event's day, already normalised to `YYYY-MM-DD`.
 * @param clock `"HH:MM"`. Anything unparseable anchors to midnight rather
 *              than producing an Invalid Date the column would reject.
 */
function clockToIso(anchorDate: string, clock: string | undefined): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(clock ?? '');
  const hours = match ? Math.min(23, Number(match[1])) : 0;
  const minutes = match ? Math.min(59, Number(match[2])) : 0;
  return `${anchorDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`;
}

/** Minutes since midnight, for a stable numeric sort on `"HH:MM"`. */
function clockToMinutes(clock: string | undefined): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(clock ?? '');
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The day a schedule hangs off.
 *
 * `timeline_blocks.start_time` is NOT NULL, so a date is required even for an
 * event that has not set one. `created_at` is the fallback because it never
 * changes, so a schedule saved twice lands on the same day both times;
 * anchoring to "today" would move the whole schedule every time it was saved.
 *
 * @param eventId The event.
 * @returns `YYYY-MM-DD`.
 */
async function resolveAnchorDate(eventId: string): Promise<string> {
  const { data } = await apiGet<{ start_date?: string | null; created_at?: string | null }>(
    `/api/events/${encodeURIComponent(eventId)}`,
  );
  const candidate = data?.start_date ?? data?.created_at ?? null;
  const at = candidate ? new Date(candidate) : new Date();
  return (Number.isNaN(at.getTime()) ? new Date() : at).toISOString().slice(0, 10);
}

export const timelineService = {
  /**
   * Read an event's schedule.
   *
   * @param eventId The event.
   * @returns Blocks in display order. Empty on failure, because a schedule
   *          that cannot be loaded should render as absent rather than throw
   *          into a component that has no boundary for it.
   */
  getEventTimeline: async (eventId: string): Promise<TimelineBlock[]> => {
    const { data, error } = await apiGet<{ blocks?: TimelineRow[] }>(
      `/api/timeline/${encodeURIComponent(eventId)}`,
    );
    if (error) {
      console.error('Error fetching timeline:', error.message);
      return [];
    }

    const rows = Array.isArray(data?.blocks) ? data.blocks : [];
    return rows
      .map((row) => ({
        id: row.id,
        label: row.label,
        description: row.description ?? '',
        start_time: isoToClock(row.start_time),
        duration: row.duration,
        type: row.type,
        guest_visible: row.guest_visible,
        notify_before: row.notify_before ?? 0,
        order: row.order_index,
      }))
      .sort((a, b) => a.order - b.order);
  },

  /**
   * Replace an event's schedule with exactly these blocks.
   *
   * Replace, not merge, because that is what the only caller means: the
   * creation wizard hands over the full list from `TimelineManagement`, which
   * holds the whole schedule in local state.
   *
   * ORDER OF OPERATIONS
   *   New blocks are created before old ones are deleted. If a create fails,
   *   the existing schedule is still intact and the error surfaces, which is
   *   the failure mode worth having. The reverse order would delete first and
   *   leave the user with nothing if a create then failed, which is exactly
   *   the data loss this file is being fixed for.
   *
   * @param eventId The event.
   * @param timelineBlocks The complete desired schedule.
   * @returns The persisted schedule, re-read from the server.
   * @throws Error when a block cannot be written. The previous schedule is
   *         left in place in that case.
   */
  updateEventTimeline: async (
    eventId: string,
    timelineBlocks: TimelineBlock[],
  ): Promise<TimelineBlock[]> => {
    const anchorDate = await resolveAnchorDate(eventId);

    const { data: existing } = await apiGet<{ blocks?: TimelineRow[] }>(
      `/api/timeline/${encodeURIComponent(eventId)}`,
    );
    const previousIds = (Array.isArray(existing?.blocks) ? existing.blocks : []).map((b) => b.id);

    const ordered = [...timelineBlocks].sort(
      (a, b) => clockToMinutes(a.start_time) - clockToMinutes(b.start_time),
    );

    for (const [index, block] of ordered.entries()) {
      const { error } = await apiPost('/api/timeline', {
        eventId,
        label: block.label,
        startTime: clockToIso(anchorDate, block.start_time),
        duration: block.duration,
        type: block.type,
        description: block.description || null,
        guestVisible: block.guest_visible !== false,
        notifyBefore: block.notify_before ?? null,
        orderIndex: index,
      });
      if (error) {
        throw new Error(`Could not save "${block.label}": ${error.message}`);
      }
    }

    // Only now that every replacement exists.
    for (const id of previousIds) {
      const { error } = await apiDelete(`/api/timeline/${encodeURIComponent(id)}`);
      if (error) {
        // The new schedule is already saved, so this leaves duplicates rather
        // than losing anything. Report it and keep going; failing here would
        // be worse than a stale row.
        console.error(`Could not remove replaced timeline block ${id}:`, error.message);
      }
    }

    return timelineService.getEventTimeline(eventId);
  },
};
