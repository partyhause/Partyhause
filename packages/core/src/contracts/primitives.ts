/**
 * The scalar vocabularies every other contract is built from.
 *
 * WHERE THESE VALUES COME FROM
 *   Not from the existing TypeScript types, which were measured to disagree
 *   with the database in fifteen places. Every enum below is transcribed from
 *   a CHECK constraint in prisma/migrations, with the migration and line
 *   number cited, because the constraint is what actually decides whether a
 *   write succeeds. A type that permits a value Postgres refuses is not a
 *   loose type, it is a 500 the route hands the user.
 *
 * ZOD IS THE DEFINITION, TYPES ARE INFERRED
 *   Nothing here is hand-written as a TypeScript type. Every type is
 *   `z.infer<typeof schema>`, so a schema and its type cannot drift: there is
 *   only one of them. The server parses with the schema at the trust boundary;
 *   the clients import the inferred type and never see zod at runtime.
 *
 * WHY CLIENTS NEVER SEE ZOD
 *   This module lives behind the `@partyhause/core/contracts` subpath, which
 *   only `server/` imports. `packages/core/src/types.ts` re-exports the
 *   inferred types with `export type`, which TypeScript erases, so no client
 *   bundle gains a zod dependency. That also sidesteps a real hazard: the root
 *   has zod 3.25.76 while apps/mobile/node_modules has 4.5.4, pulled in by
 *   eslint-plugin-react-hooks. Keeping the schemas server-side means the two
 *   majors never have to agree.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Identifiers and timestamps
// ---------------------------------------------------------------------------

/**
 * A row identifier.
 *
 * Deliberately not `z.string().uuid()`. Most tables default to
 * `gen_random_uuid()`, but `user_profiles.id` is supplied by the application
 * and the dev-bypass user is the literal `dev-user-00000000-...`
 * (server/middleware/auth.ts:38), which is not a valid UUID. Rejecting it here
 * would make the contract stricter than the database and break local work.
 */
export const identifier = z.string().min(1).max(128);

/** An ISO-8601 instant, as every route serialises timestamps. */
export const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'must be an ISO-8601 date-time string',
  });

/** A calendar date with no time component, `YYYY-MM-DD`. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Text that must survive trimming. Rejects `"   "`, which `.min(1)` accepts. */
export const nonEmptyText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, { message: 'cannot be blank' });

/** Optional free text that treats the empty string as "clear this field". */
export const clearableText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .nullable();

/**
 * An email address.
 *
 * `guests.email` is NOT NULL with CHECK `length(trim(email)) > 0`
 * (20260905000200_core_integrity_constraints/migration.sql:24-26), and
 * `guests.normalized_email` carries CHECK `length(normalized_email) > 0`
 * (20260906000000_ios_mvp_domain/migration.sql:120-124) maintained by the
 * `normalize_guest_email` trigger at :415.
 *
 * So an empty address is not "a guest without an email". It is a constraint
 * violation, and `server/routes/guests.ts:147` writes `guest.email || ''`
 * today, which is a 500 the moment a guest is added without one.
 */
export const emailAddress = z
  .string()
  .max(254)
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: 'must be a valid email address',
  });

/**
 * A URL safe to render as a clickable link.
 *
 * Mirrors server/routes/users.ts:92-94. Anything other than http(s), so
 * `javascript:`, `data:` and `vbscript:`, is a stored-XSS payload rather than
 * a website.
 */
export const webUrl = z
  .string()
  .max(200)
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'must start with http:// or https://',
  });

// ---------------------------------------------------------------------------
// Enumerations, each transcribed from its CHECK constraint
// ---------------------------------------------------------------------------

/**
 * CHECK `rsvp_status IN ('pending','accepted','declined','maybe')`
 * (20260906000000_ios_mvp_domain/migration.sql:118-119).
 *
 * `'confirmed'` is NOT a member. That migration rewrote every existing
 * `'confirmed'` row to `'accepted'` at :87-88 and then narrowed the
 * constraint. `server/routes/guests.ts:207` still accepts it as a "legacy
 * alias", so the route says 200 and Postgres says no: a 500 with no useful
 * message. Three client types still model it too.
 */
export const rsvpStatus = z.enum(['pending', 'accepted', 'declined', 'maybe']);

/**
 * CHECK `status IN ('draft','published','active','completed','cancelled','archived')`
 * (20260905000200_core_integrity_constraints/migration.sql:20-22).
 */
export const eventStatus = z.enum([
  'draft',
  'published',
  'active',
  'completed',
  'cancelled',
  'archived',
]);

/** CHECK `privacy IN ('public','private','unlisted')` (same migration, :16-18). */
export const eventPrivacy = z.enum(['public', 'private', 'unlisted']);

/** CHECK `event_type IN ('single_day','multi_day')` (same migration, :8-10). */
export const eventType = z.enum(['single_day', 'multi_day']);

/**
 * CHECK `role IN ('host','co-host','guest','vendor','volunteer')`
 * (20260905000200_core_integrity_constraints/migration.sql:36-38).
 */
export const guestRole = z.enum(['host', 'co-host', 'guest', 'vendor', 'volunteer']);

/**
 * CHECK `email_status IN (...)`
 * (20260905000200_core_integrity_constraints/migration.sql:28-30).
 */
export const emailStatus = z.enum([
  'not_sent',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'failed',
]);

/**
 * CHECK `account_status IN ('active','deletion_pending')`
 * (20260906000000_ios_mvp_domain/migration.sql:107-108).
 */
export const accountStatus = z.enum(['active', 'deletion_pending']);

/** `user_profiles.account_type` default `'personal'` (prisma/schema.prisma:671). */
export const profileAccountType = z.enum(['personal', 'business', 'creator']);

// ---------------------------------------------------------------------------
// Bounded numbers
// ---------------------------------------------------------------------------

/**
 * CHECK `max_guests BETWEEN 1 AND 50`
 * (20260906000000_ios_mvp_domain/migration.sql:113-114).
 *
 * A trigger also enforces the same ceiling on the guest count itself
 * (`enforce_event_guest_limit`, :430).
 */
export const maxGuests = z.number().int().min(1).max(50);

/** CHECK `plus_ones >= 0` (20260905000200:40-42). */
export const plusOnes = z.number().int().min(0);

/**
 * CHECK `revision >= 1` on both events and guests
 * (20260906000000_ios_mvp_domain/migration.sql:116-117 and :126).
 *
 * The optimistic-concurrency token: an `/api/mvp` write carries the revision
 * it expects to be replacing, which is what stops two editors overwriting each
 * other silently.
 */
export const revision = z.number().int().min(1);

/** A denormalised counter. Never negative. */
export const counter = z.number().int().min(0);

// ---------------------------------------------------------------------------
// Inferred types. Hand-writing any of these would reintroduce the drift.
// ---------------------------------------------------------------------------

export type Identifier = z.infer<typeof identifier>;
export type IsoDateTime = z.infer<typeof isoDateTime>;
export type IsoDate = z.infer<typeof isoDate>;
export type EmailAddress = z.infer<typeof emailAddress>;
export type RsvpStatus = z.infer<typeof rsvpStatus>;
export type EventStatus = z.infer<typeof eventStatus>;
export type EventPrivacy = z.infer<typeof eventPrivacy>;
export type EventType = z.infer<typeof eventType>;
export type GuestRole = z.infer<typeof guestRole>;
export type EmailStatus = z.infer<typeof emailStatus>;
export type AccountStatus = z.infer<typeof accountStatus>;
export type ProfileAccountType = z.infer<typeof profileAccountType>;
