-- RSVP can require a verified account bound to the invited address, per
-- invitation.
--
-- WHY THE DEFAULT IS false AND NOT true
--   An earlier draft of this migration flipped the default to true, making
--   every new invitation account-required. That is the wrong default while the
--   app is iPhone-only:
--   docs/mobile-ios-launch/07-ios-app-store-launch-requirements.md:82 names an
--   Android launch a submission blocker, so at 1.0 an Android guest has
--   nothing to install and an account-required invitation is one they can
--   never answer. On a 50-person guest list that silently removes a large
--   fraction of the room, and the person it fails is the host.
--
--   So the column is a per-invitation switch with anonymous as the default. A
--   host who wants an account-gated event can have one, and the difference can
--   be measured rather than assumed. Flip the default once an Android build
--   exists; it is one ALTER.
--
--   The RSVP page and the invitation email both push the install hard and say
--   why, because check-in and the live schedule genuinely need the app. That
--   is an upsell at the moment of highest intent rather than a wall in front
--   of the reply.
--
-- TWO STRUCTURAL CHANGES AND ONE BACKFILL
--
--   1. guest_invitations.requires_account records which contract an invitation
--      was issued under. Added with DEFAULT false, which backfills every
--      existing row in one atomic statement and is also the ongoing default.
--      Deliberately not expressed as a time predicate such as
--      created_at < now(): that would classify rows differently depending on
--      when the migration ran, so replaying it against a restored dump would
--      not reproduce the same database.
--
--   2. guests(event_id, user_id) becomes unique. PostgreSQL treats NULLs as
--      distinct in a unique index, so the unbound guest rows an event holds
--      before anybody responds are untouched; only claimed seats can collide.
--      Without it, two concurrent RSVP claims from one account could bind two
--      guest rows on one event, producing a duplicate attendee and a second
--      check-in slot for the same person.
--
-- IDEMPOTENT BY CONSTRUCTION
-- Every statement is guarded, so a second run is a no-op. prisma/seed and
-- npm run test:migrations both replay the history twice.
--
-- PRECONDITION
-- scripts/production-migration-preflight.cjs proves no event already holds two
-- guests bound to the same user_id. A violation aborts statement 3 with the
-- first two already applied, which is a half-migrated table and far more
-- expensive to unpick than a read-only check beforehand.

ALTER TABLE public.guest_invitations
  ADD COLUMN IF NOT EXISTS requires_account BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS guests_event_id_user_id_key
  ON public.guests(event_id, user_id);
