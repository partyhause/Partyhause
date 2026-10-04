/**
 * Polls, notifications and timeline blocks.
 *
 * Grouped because each was typed several times and each carried a concrete,
 * user-visible defect that the duplication hid:
 *
 *   POLL, 6 definitions. `packages/core`'s version is not merely incomplete,
 *   it is fiction. It declares `PollOption.label` and `.vote_count`, and the
 *   server sends `text` and `votes` (`server/routes/polls.ts:89,92`). It
 *   declares `Poll.is_closed`; the server sends `status`. Eleven further
 *   fields are missing. All five poll endpoints PASS `audit:contracts`,
 *   because that script compares the envelope key and never the payload.
 *
 *   NOTIFICATION, 4 definitions. `packages/core` says `read_at?: string|null`;
 *   the column and the wire both say `read: boolean`
 *   (`server/routes/notifications.ts:29,75`). A mobile client reading
 *   `read_at` gets `undefined` for every row, read or not, so every
 *   notification renders as unread forever.
 *
 *   TIMELINE BLOCK, 5 definitions, disagreeing on whether `description` is
 *   nullable, whether the ordering field is `order_index` or `order`, and
 *   whether `start_time` is `"HH:MM"` or an ISO instant. It is both, because
 *   the JSON column on `events` and the `timeline_blocks` table store it
 *   differently, and the web still reads the former through a DTO that has
 *   withheld it since `event-dto.ts` was written.
 */

import { z } from 'zod';
import { counter, identifier, isoDateTime } from './primitives';

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

/** One option, as `server/routes/polls.ts:86-96` builds it. */
export const pollOption = z.object({
  id: identifier,
  /** Not `label`. */
  text: z.string(),
  description: z.string().nullable(),
  /** Not `vote_count`. */
  votes: counter,
  /** User ids. Present because the UI renders avatars, not just a total. */
  voters: z.array(identifier),
  /** Per-viewer. A counter cannot answer this, which is why votes are rows. */
  user_has_voted: z.boolean(),
});

/** `server/routes/polls.ts:100-117`. */
export const poll = z.object({
  id: identifier,
  event_id: identifier.nullable(),
  node_id: identifier.nullable(),
  created_by: identifier.nullable(),
  /** Falls back to the literal `'Unknown'` (`polls.ts:105`). */
  creator_name: z.string(),
  question: z.string(),
  poll_type: z.string().nullable(),
  options: z.array(pollOption),
  ends_at: isoDateTime.nullable(),
  auto_close_on_consensus: z.boolean().nullable(),
  consensus_threshold: z.number().nullable(),
  /** Not `is_closed`. A string, not a boolean. */
  status: z.string().nullable(),
  total_votes: counter,
  total_voters: counter,
  created_at: isoDateTime.nullable(),
  closed_at: isoDateTime.nullable(),
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** The actor join (`server/routes/notifications.ts:35-37`). */
export const notificationActor = z.object({
  id: identifier,
  username: z.string(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
});

export const notification = z.object({
  id: identifier,
  user_id: identifier,
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** A boolean. Never `read_at`. */
  read: z.boolean(),
  actor: notificationActor.nullable(),
  event_id: identifier.nullable(),
  post_id: identifier.nullable(),
  action_data: z.unknown().nullable(),
  expires_at: isoDateTime.nullable(),
  created_at: isoDateTime,
});

/**
 * `POST /api/notifications/mark-read`.
 *
 * Exactly one of the two forms, never both and never neither. A union rather
 * than two optional fields, so `{}` and `{ids:[], all:true}` are both refused
 * by the schema instead of by four hand-rolled checks
 * (`server/routes/notifications.ts:72-88`).
 */
export const notificationMarkRead = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(identifier).min(1).max(50) }),
]);

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * A block from the `timeline_blocks` table.
 *
 * Transcribed from `prisma/schema.prisma` and `server/routes/timeline.ts`, not
 * from the previous type. The field set is `label` / `duration` / `type`, not
 * `title` / `start_time` / `end_time`: duration is what is stored, so there is
 * no end time to read, and `packages/core/src/resources/index.ts:57-73`
 * already had this right while `packages/core/src/types.ts:183-203` did not.
 *
 * This is also the only path that applies `guest_visible` per block.
 * `server/lib/event-dto.ts:146-164` deliberately withholds the legacy JSON
 * column on `events`, which is why `src/lib/timeline.ts:27` reads `[]` for
 * every event and then writes that empty array back over the schedule.
 */
export const timelineBlockType = z.enum([
  'activity',
  'meal',
  'speech',
  'performance',
  'break',
  'custom',
]);

export const timelineBlock = z.object({
  id: identifier,
  event_id: identifier,
  label: z.string(),
  description: z.string().nullable(),
  /** ISO-8601. A `DateTime` column, not the legacy `"HH:MM"` string. */
  start_time: isoDateTime,
  /** Minutes. There is no end_time; duration is what the table stores. */
  duration: z.number().int().min(0),
  type: timelineBlockType,
  host_notes: z.string().nullable(),
  guest_visible: z.boolean(),
  /** Minutes before `start_time` to send a reminder. */
  notify_before: z.number().int().min(0).nullable(),
  location: z.string().nullable(),
  assigned_to: z.array(identifier),
  order_index: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

/** `POST /api/timeline` (server/routes/timeline.ts:61-76). */
export const timelineBlockCreate = z.object({
  eventId: identifier,
  label: z.string().min(1).max(255),
  startTime: isoDateTime,
  duration: z.number().int().min(0),
  type: timelineBlockType,
  description: z.string().max(2000).nullish(),
  hostNotes: z.string().max(2000).nullish(),
  guestVisible: z.boolean().optional(),
  notifyBefore: z.number().int().min(0).nullish(),
  location: z.string().max(255).nullish(),
  assignedTo: z.array(identifier).max(50).optional(),
  orderIndex: z.number().int().min(0).optional(),
});

/** `PUT /api/timeline/:id`. Every field optional, at least one required. */
export const timelineBlockPatch = timelineBlockCreate
  .omit({ eventId: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Provide at least one field to update',
  });

export type PollOption = z.infer<typeof pollOption>;
export type Poll = z.infer<typeof poll>;
export type NotificationActor = z.infer<typeof notificationActor>;
export type Notification = z.infer<typeof notification>;
export type NotificationMarkRead = z.infer<typeof notificationMarkRead>;
export type TimelineBlockType = z.infer<typeof timelineBlockType>;
export type TimelineBlock = z.infer<typeof timelineBlock>;
export type TimelineBlockCreate = z.infer<typeof timelineBlockCreate>;
export type TimelineBlockPatch = z.infer<typeof timelineBlockPatch>;
