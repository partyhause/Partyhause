/**
 * The guest contract.
 *
 * `Guest` was typed nine times across this repository, plus three separate
 * input types, and the definitions disagreed in ways that are not cosmetic.
 * Three of those disagreements are live 500s, because the route's hand-rolled
 * validation is looser than the CHECK constraint it writes through:
 *
 *   1. `server/routes/guests.ts:207` accepts `'confirmed'`. The constraint
 *      (20260906000000:118-119) does not; that migration rewrote the existing
 *      rows to `'accepted'` and narrowed the vocabulary.
 *   2. `server/routes/guests.ts:147` writes `guest.email || ''`. The
 *      `normalize_guest_email` trigger derives `normalized_email` from it, and
 *      CHECK (20260906000000:120-124) requires that to be non-empty.
 *   3. `PUT /api/guests/:id {checkedIn:true}` sets the flag with no RSVP check
 *      (`:274-279`), but CHECK `guests_check_in_requires_accepted_check`
 *      (:127-131) permits check-in only when `rsvp_status = 'accepted'`.
 *
 * The third is encoded as a cross-field rule on the patch schema rather than
 * left to the database, so the caller gets a 400 naming the problem instead of
 * a 500 naming nothing.
 */

import { z } from 'zod';
import {
  counter,
  emailAddress,
  emailStatus,
  guestRole,
  identifier,
  isoDateTime,
  nonEmptyText,
  plusOnes,
  revision,
  rsvpStatus,
} from './primitives';

/**
 * A guest as the API returns it.
 *
 * Field names are snake_case because that is what the routes serialise;
 * `/api/mvp` uses camelCase and has its own DTO. Two naming conventions on one
 * concept is a real cost, and it is the flat routers' convention that both
 * clients actually consume today.
 */
export const guest = z.object({
  id: identifier,
  event_id: identifier,
  name: z.string(),

  /**
   * Always present and always non-empty.
   *
   * Modelled optional by `src/store/usePartyStore.ts` and by
   * `packages/core/src/resources/legacy-guests.ts:21`. It is NOT NULL with a
   * non-empty CHECK, so those types describe rows that cannot exist.
   */
  email: z.string(),

  phone: z.string().nullable(),
  rsvp_status: rsvpStatus,
  role: guestRole,
  plus_ones: plusOnes,

  /**
   * A Postgres `text[]`.
   *
   * `GuestUpdateInput.dietaryRestrictions` was typed `string`
   * (legacy-guests.ts:11) and written straight into the array column at
   * `server/routes/guests.ts:262`, and `apps/mobile/types/guest.ts` types it
   * `string` as well. Both are wrong in the same direction.
   */
  dietary_restrictions: z.array(z.string()),

  custom_fields: z.record(z.unknown()),

  checked_in: z.boolean(),
  checked_in_at: isoDateTime.nullable(),

  ticket_type: z.string().nullable(),
  ticket_id: z.string().nullable(),
  qr_code: z.string().nullable(),

  email_status: emailStatus,
  last_email_sent_at: isoDateTime.nullable(),
  email_log_id: identifier.nullable(),

  revision,
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

/**
 * One guest inside a `POST /api/guests` batch.
 *
 * camelCase, because that is what the route destructures
 * (`server/routes/guests.ts:137-155`). `rsvp_status` is absent by design: the
 * route always writes `'pending'` (`:154`) and ignores anything sent.
 */
export const guestCreate = z.object({
  name: nonEmptyText(200),
  email: emailAddress,
  phone: z.string().max(50).nullish(),
  ticketType: z.string().max(100).nullish(),
  /** Caller-supplied ticket id; the route mints one when absent (`guests.ts:143`). */
  ticketId: identifier.nullish(),
  plusOnes: plusOnes.optional(),
  dietaryRestrictions: z.array(z.string().max(200)).max(50).optional(),
  customFields: z.record(z.unknown()).optional(),
  role: guestRole.optional(),
});

/**
 * The `POST /api/guests` body.
 *
 * The batch is capped at 50 because `enforce_event_guest_limit`
 * (20260906000000:430) refuses to let an event exceed that, and
 * `events_max_guests_check` bounds the column the same way. An uncapped batch
 * is a trigger exception rather than a validation error.
 */
export const guestCreateBatch = z.object({
  eventId: identifier,
  guests: z.array(guestCreate).min(1).max(50),
});

/**
 * The `PUT /api/guests/:id` body.
 *
 * Every field optional, but at least one required: the route answers 400 for
 * an empty patch rather than performing a silent no-op update.
 */
export const guestPatch = z
  .object({
    name: nonEmptyText(200).optional(),
    email: emailAddress.optional(),
    phone: z.string().max(50).nullish(),
    rsvpStatus: rsvpStatus.optional(),
    plusOnes: plusOnes.optional(),
    dietaryRestrictions: z.array(z.string().max(200)).max(50).optional(),
    customFields: z.record(z.unknown()).optional(),
    checkedIn: z.boolean().optional(),
    role: guestRole.optional(),
    // Host-operated email tracking. Authorization for these is enforced by the
    // route (`server/routes/guests.ts:246-252`); the shape is enforced here.
    email_status: emailStatus.optional(),
    last_email_sent_at: isoDateTime.nullish(),
    email_log_id: identifier.nullish(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine(
    // CHECK guests_check_in_requires_accepted_check (20260906000000:127-131).
    // Checking someone in while their RSVP says anything but 'accepted' is a
    // constraint violation. Caught here, it is a 400 that says so; left to the
    // database it is a 500 that does not. The rule only fires when the caller
    // sets both in one request; a check-in against a stored 'pending' still
    // needs the route to compare with the existing row.
    (patch) =>
      !(patch.checkedIn === true && patch.rsvpStatus !== undefined && patch.rsvpStatus !== 'accepted'),
    { message: 'A guest can only be checked in once their RSVP is accepted' },
  );

/** The `{ stats }` block `GET /api/guests` returns (server/routes/guests.ts:81-92). */
export const guestStats = z.object({
  total: counter,
  accepted: counter,
  declined: counter,
  maybe: counter,
  pending: counter,
  checkedIn: counter,
});

export type Guest = z.infer<typeof guest>;
export type GuestCreate = z.infer<typeof guestCreate>;
export type GuestCreateBatch = z.infer<typeof guestCreateBatch>;
export type GuestPatch = z.infer<typeof guestPatch>;
export type GuestStats = z.infer<typeof guestStats>;
