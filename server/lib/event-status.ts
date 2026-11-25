/**
 * The `events.status` vocabulary, and what a client may set it to.
 *
 * WHY THIS IS A MODULE AND NOT A STRING LITERAL
 *   `POST /api/events` never destructured `status` and hardcoded `'draft'`
 *   (the defect this module exists to close), while `PUT /api/events/:id`
 *   accepted whatever arrived and wrote it straight to the column. Those are
 *   the two halves of one missing rule, and they were three hundred lines
 *   apart. Putting the rule in one pure module is what stops them drifting
 *   again.
 *
 * THE DATABASE IS THE AUTHORITY ON SHAPE
 *   `events_status_check` is created by
 *   prisma/migrations/20260905000200_core_integrity_constraints/migration.sql:20-21
 *
 *     CHECK (status IN ('draft','published','active','completed','cancelled','archived'))
 *
 *   {@link EVENT_STATUSES} is transcribed from that constraint, not from the
 *   TypeScript. A value this module accepts can never be refused by Postgres.
 *   The converse is deliberate: policy (what may be set at creation) lives
 *   here, where it changes without a migration, while shape lives in the
 *   database, where no second writer can bypass it.
 *
 * WHY UNVALIDATED INPUT WAS WORSE THAN A 400
 *   An unrecognised status reached Postgres and raised a check violation,
 *   which the global error handler returns as a 500 carrying `err.message`
 *   (server/index.ts:393, recorded in AGENTS.md as a known defect). So a
 *   client typo produced a server error that leaked a constraint name. It is
 *   now a 400 that names the field.
 */

/** Every value `events.status` may hold. Matches `events_status_check`. */
export const EVENT_STATUSES = [
  'draft',
  'published',
  'active',
  'completed',
  'cancelled',
  'archived',
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * What a client may assign when *creating* an event.
 *
 * Narrower than the full vocabulary on purpose. `active`, `completed`,
 * `cancelled` and `archived` describe things that happened to an event, and an
 * event that has just been created has had nothing happen to it. Accepting
 * them here would let a caller manufacture a history the row cannot support:
 * a `cancelled` event that was never published, or a `completed` one that
 * never ran.
 */
export const CREATABLE_EVENT_STATUSES = ['draft', 'published'] as const;

export type CreatableEventStatus = (typeof CREATABLE_EVENT_STATUSES)[number];

/** True when `value` is a member of the status vocabulary. */
export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && (EVENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Resolve the status for a newly created event.
 *
 * @param value The raw `status` field from the request body. Absent is the
 *        normal case: the web creation form has never sent one.
 * @returns The status to persist, or `null` when the caller sent something
 *          that is not creatable. `null` means "reply 400", never "use a
 *          default": silently substituting a default for a value the caller
 *          explicitly chose is how `status: 'published'` was discarded for the
 *          life of this endpoint.
 *
 * Complexity: O(1). No I/O.
 */
export function parseCreateStatus(value: unknown): CreatableEventStatus | null {
  if (value === undefined || value === null) return 'draft';
  if (typeof value !== 'string') return null;
  return (CREATABLE_EVENT_STATUSES as readonly string[]).includes(value)
    ? (value as CreatableEventStatus)
    : null;
}

/**
 * Resolve the status for an update.
 *
 * The full vocabulary is permitted here, because an update is where the
 * lifecycle actually advances.
 *
 * @param value The raw `status` field from the request body.
 * @returns The status to persist, or `null` when it is not a recognised value.
 *
 * NOT A STATE MACHINE. This validates the value, not the transition. The MVP
 * router enforces an ordering (`server/lib/mvp-events.ts:304-307` refuses to
 * publish anything that is not a draft); this route never has, and imposing
 * one here would reject flows that work today, including the mobile archive
 * action. The ordering belongs on `/api/mvp`, which is where new work goes.
 *
 * Complexity: O(1). No I/O.
 */
export function parseUpdateStatus(value: unknown): EventStatus | null {
  return isEventStatus(value) ? value : null;
}

/** The lifecycle timestamp columns, as a partial update. */
export interface StatusTimestamps {
  published_at?: Date;
  cancelled_at?: Date | null;
}

/**
 * Derive the lifecycle timestamps implied by moving to `next`.
 *
 * `published_at` and `cancelled_at` exist on the row
 * (`prisma/schema.prisma:39-40`) and were never written by this route, so an
 * event published through `/api/events` recorded no publication time. The MVP
 * service writes them and this one did not, which meant the same column meant
 * different things depending on which client created the row.
 *
 * @param next The status being moved to. Already validated.
 * @param current The row's present state, or `null` when creating.
 * @param now Injected so the caller's clock is the one under test.
 * @returns Only the fields that should change. An empty object is a valid and
 *          common answer.
 *
 * Rules, and why each one:
 *   - `published_at` is set once and never rewritten. It answers "when was
 *     this first published", which a later cancellation does not undo.
 *   - `cancelled_at` is set on entry to `cancelled` and cleared on exit. A row
 *     reading `published` while carrying a `cancelled_at` is self
 *     contradictory, and something downstream will eventually believe the
 *     wrong half of it.
 *
 * Complexity: O(1). No I/O.
 */
export function statusTimestamps(
  next: EventStatus,
  current: { status: string; published_at: Date | null } | null,
  now: Date = new Date(),
): StatusTimestamps {
  const fields: StatusTimestamps = {};

  if (next === 'published' && !current?.published_at) {
    fields.published_at = now;
  }

  if (next === 'cancelled') {
    if (current?.status !== 'cancelled') fields.cancelled_at = now;
  } else if (current?.status === 'cancelled') {
    fields.cancelled_at = null;
  }

  return fields;
}
