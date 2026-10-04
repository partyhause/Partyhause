/**
 * The event contract.
 *
 * `Event` was typed eight times, plus four partial shapes, and the definitions
 * disagreed with the wire in ways that TypeScript actively lied about:
 *
 *   - `PartyEvent.is_public` and `.updated_at` are declared REQUIRED and are
 *     absent from every GET response. `server/lib/event-dto.ts:146-164` is an
 *     allowlist and neither field is on it, so the type promises a boolean and
 *     hands back `undefined`.
 *   - `capabilities` and `relationship` are returned by the server on every
 *     event (`event-dto.ts:95-97`) and were typed by nobody, so every client
 *     re-derived permissions it was already being told.
 *   - `timeline_blocks` is typed on the client and deliberately withheld by
 *     the server. `src/lib/timeline.ts:27` reads it, always gets `[]`, and its
 *     write path then persists that empty array over the real schedule.
 *
 * This schema is transcribed from the serialiser, not from the Prisma model.
 * Those are different shapes on purpose: the DTO is an allowlist that exists
 * to stop host-private fields leaking to guests.
 */

import { z } from 'zod';
import {
  counter,
  eventPrivacy,
  eventStatus,
  eventType,
  identifier,
  isoDateTime,
  nonEmptyText,
  maxGuests,
} from './primitives';

/**
 * What the viewer may do, computed server-side and sent explicitly.
 *
 * `event-dto.ts:66-72`. Sent on every event response. Clients should read this
 * rather than comparing `host_id` to the current user, which is what they do
 * today and which is wrong for co-hosts.
 */
export const eventCapabilities = z.object({
  can_edit: z.boolean(),
  can_delete: z.boolean(),
  can_manage_guests: z.boolean(),
  can_invite: z.boolean(),
  can_view_insights: z.boolean(),
});

/** How the viewer relates to the event (`event-dto.ts:99`). */
export const eventRelationship = z.enum(['host', 'co_host', 'guest', 'public']);

/**
 * The fields every viewer may see (`event-dto.ts:146-164`).
 *
 * Nullable almost throughout, because the serialiser's `str()` and `date()`
 * helpers coerce a missing column to null rather than omitting the key.
 *
 * `cover_image_url` is present on the wire and permanently `null`: no such
 * column exists on `model Event` (prisma/schema.prisma:165-237). It is typed
 * here because it is genuinely sent, with the caveat recorded rather than
 * quietly dropped.
 */
export const publicEvent = z.object({
  id: identifier,
  /** `name`, falling back to the legacy `title` column, never null (`:150`). */
  name: z.string(),
  description: z.string().nullable(),
  start_date: isoDateTime.nullable(),
  end_date: isoDateTime.nullable(),
  timezone: z.string().nullable(),
  location: z.string().nullable(),
  event_type: eventType.nullable(),
  template_type: z.string().nullable(),
  privacy: eventPrivacy.nullable(),
  status: eventStatus.nullable(),
  /** Always null: the column does not exist. See the note above. */
  cover_image_url: z.string().nullable(),
  host_id: identifier,
  created_at: isoDateTime.nullable(),
});

/**
 * Host and co-host additions (`event-dto.ts:166-174`).
 *
 * `capacity` and `budget` share `cover_image_url`'s problem: both are read off
 * the row and neither column exists, so both are permanently null.
 */
export const hostEvent = publicEvent.extend({
  settings: z.unknown().nullable(),
  template_data: z.unknown().nullable(),
  capacity: z.number().nullable(),
  budget: z.unknown().nullable(),
});

/**
 * The wire shape: event fields flat, capabilities and relationship as siblings.
 *
 * Flat rather than `{ event, capabilities }` for the reason recorded at
 * `event-dto.ts:84-93`: clients already read `events[0].name`, and nesting
 * would have been a silent breaking change `audit:contracts` cannot catch.
 */
export const serialisedEvent = hostEvent.partial({
  settings: true,
  template_data: true,
  capacity: true,
  budget: true,
}).extend({
  capabilities: eventCapabilities,
  relationship: eventRelationship,
});

/** The `{ stats }` block on `GET /api/events` (server/routes/events.ts:60-71). */
export const eventStats = z.object({
  total_guests: counter,
  guests_accepted: counter,
  guests_declined: counter,
  guests_pending: counter,
  guests_checked_in: counter,
  timeline_blocks: counter,
  media_count: counter,
});

/**
 * The `POST /api/events` body.
 *
 * `max_guests` is bounded 1..50 by CHECK `events_max_guests_check`
 * (20260906000000:113-114) and independently by the
 * `enforce_event_guest_limit` trigger (:430).
 */
export const eventCreate = z.object({
  name: nonEmptyText(200),
  description: z.string().max(5000).nullish(),
  start_date: isoDateTime.nullish(),
  end_date: isoDateTime.nullish(),
  timezone: z.string().max(64).nullish(),
  location: z.string().max(500).nullish(),
  event_type: eventType.optional(),
  template_type: z.string().max(100).nullish(),
  privacy: eventPrivacy.optional(),
  status: eventStatus.optional(),
  max_guests: maxGuests.nullish(),
  settings: z.record(z.unknown()).optional(),
  template_data: z.record(z.unknown()).optional(),
});

/**
 * The `PUT /api/events/:id` body.
 *
 * Last-write-wins, unlike `PATCH /api/mvp/events/:id`, which carries an
 * expected revision. That difference is why the two surfaces exist; it is
 * recorded here so a caller choosing this route knows what it is choosing.
 */
export const eventPatch = eventCreate
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine(
    // CHECK check_end_date_after_start_date (20260905000200:12-14). Only
    // checkable here when both are in the same request; otherwise the route
    // must compare against the stored row.
    (patch) => {
      if (!patch.start_date || !patch.end_date) return true;
      return Date.parse(patch.end_date) >= Date.parse(patch.start_date);
    },
    { message: 'end_date cannot be before start_date' },
  );

export type EventCapabilities = z.infer<typeof eventCapabilities>;
export type EventRelationship = z.infer<typeof eventRelationship>;
export type PublicEvent = z.infer<typeof publicEvent>;
export type HostEvent = z.infer<typeof hostEvent>;
export type SerialisedEvent = z.infer<typeof serialisedEvent>;
export type EventStats = z.infer<typeof eventStats>;
export type EventCreate = z.infer<typeof eventCreate>;
export type EventPatch = z.infer<typeof eventPatch>;
