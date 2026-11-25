-- Row-level security: user-scoped access architecture
--
-- WHAT THIS MIGRATION IS
--   A defence-in-depth layer beneath the API. Today the Express API connects
--   as the table owner (`partyadmin`), and every request is authorised in
--   application code. That stays true. This migration adds a second, stricter
--   access path - the `partyhause_app` role - whose visibility is limited by
--   row-level security to rows the scoped user owns, so any future client
--   that reaches the database directly (PostgREST, a pooled reader, a
--   reporting job) inherits the API's authorisation model from the database
--   instead of reimplementing it.
--
-- WHY NOT FORCE ROW LEVEL SECURITY
--   `partyadmin` owns these tables. RLS does not apply to a table's owner
--   unless FORCE is set, so the API's existing behaviour is unchanged -
--   including the intentional cross-user reads a host makes over their
--   guests, and the anonymous RSVP claim path (server/routes/rsvp.ts), both
--   of which authorise in application code by design. Forcing RLS here would
--   break those paths for zero gain while the only database role is the
--   trusted server. If the API ever connects as `partyhause_app`, FORCE
--   becomes the right switch, and this migration's policies are already
--   written for it.
--
-- THE CONTEXT CONTRACT
--   Policies read `current_setting('app.user_id', true)`. A session that has
--   not set the GUC gets NULL from the two-argument form, and a NULL never
--   equals a row's owner column, so an unscoped session sees nothing rather
--   than everything. No server code sets the GUC today: the API connects as
--   the table owner, to which RLS does not apply, so there is nothing to set
--   yet. Any client that adopts the `partyhause_app` role MUST set the GUC
--   per transaction with `SET LOCAL app.user_id = '<uuid>'` (SET LOCAL, not
--   SET, so the value cannot leak across a connection pool) before its first
--   query, and that helper does not exist in server/lib/prisma.ts yet. An
--   adoption that forgets this reads an empty database, which is loud in a
--   smoke test and silent in a report.
--
-- USERNAME UNIQUENESS (the "already taken" half of the request)
--   Uniqueness is already enforced by two unique indexes
--   (user_profiles_username_key, user_profiles_username_normalized_key) plus
--   format/length/invariant CHECKs from 20260905000200 and 20260913000000.
--   This migration does not duplicate them. What it adds is the RLS half: a
--   non-owner role can no longer enumerate other people's handles at all,
--   which is the actual asset the "taken username" surface exposes
--   (GET /api/users/username-available is authenticated for the same reason).
--
-- IDEMPOTENCE
--   Every statement is guarded (IF NOT EXISTS / DO blocks). Re-running this
--   file - as test:migrations does for the functions migration - is a no-op.

-- ---------------------------------------------------------------------------
-- 1. The scoped role
-- ---------------------------------------------------------------------------
-- NOLOGIN: nothing authenticates as this role directly yet. A future pooled
-- credential can be added with ALTER ROLE ... PASSWORD without touching these
-- policies. The API can also enter it per transaction with SET LOCAL ROLE,
-- which this migration deliberately does not do.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partyhause_app') THEN
    CREATE ROLE partyhause_app NOLOGIN;
  END IF;
END
$$;

COMMENT ON ROLE partyhause_app IS
  'RLS-scoped application role. Sees only rows owned by app.user_id (plus shared event rows). Not FORCEd: the API still connects as the table owner.';

-- ---------------------------------------------------------------------------
-- 2. Enumerate the user-owned tables and their owner columns
-- ---------------------------------------------------------------------------
-- The list mirrors the schema: every table whose rows belong to one user by a
-- single owner column. Shared surfaces (events, guests, their satellites) get
-- their own policies in section 4 rather than the generic one, because a host
-- must see rows that belong to someone else's user_id.

CREATE TEMP TABLE _rls_user_scoped (
  table_name TEXT PRIMARY KEY,
  owner_col  TEXT NOT NULL
);
INSERT INTO _rls_user_scoped (table_name, owner_col) VALUES
  ('account_deletion_requests', 'user_id'),
  ('activity_participants',     'user_id'),
  ('ai_usage',                  'user_id'),
  ('connections',               'follower_id'),
  ('content_interactions',      'user_id'),
  ('cost_split_requests',       'created_by'),
  ('event_co_hosts',            'user_id'),
  ('event_invite_tokens',       'created_by'),
  ('feed_read_status',          'user_id'),
  ('guest_crew_conversions',    'user_id'),
  ('invite_templates',          'host_id'),
  ('notifications',             'user_id'),
  ('onboarding_responses',      'user_id'),
  ('partyboard_sticky_votes',   'user_id'),
  ('poll_votes',                'user_id'),
  ('post_comments',             'user_id'),
  ('post_likes',                'user_id'),
  ('post_shares',               'user_id'),
  ('saved_events',              'user_id'),
  ('subscriptions',             'user_id'),
  ('template_usage',            'user_id');

-- ---------------------------------------------------------------------------
-- 3. Generic owner-scoped RLS on the straightforward tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t  TEXT;
  c  TEXT;
BEGIN
  FOR t, c IN SELECT table_name, owner_col FROM _rls_user_scoped LOOP
    EXECUTE format(
      'ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'owner_scoped'
    ) THEN
      EXECUTE format(
        'CREATE POLICY owner_scoped ON %I USING (%I = current_setting(''app.user_id'', true))',
        t, c);
    END IF;

    -- The role gets row visibility through the policy, but still needs table
    -- privileges to exercise it.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO partyhause_app', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4a. The shared-visibility helper
-- ---------------------------------------------------------------------------
-- The event/guest/co-host policies below reference other RLS-enabled tables
-- inside EXISTS subqueries. Under the same role those subqueries re-evaluate
-- the referenced tables' own policies, which recurses until Postgres aborts
-- ("infinite recursion detected in policy"). A SECURITY DEFINER helper owned
-- by the table owner evaluates the membership checks with RLS bypassed - the
-- owner is exempt - while remaining read-only over exactly these three
-- tables. This is the standard Postgres pattern for cross-table RLS.
CREATE OR REPLACE FUNCTION public.app_user_can_see_event(p_event_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND e.host_id = current_setting('app.user_id', true)
  ) OR EXISTS (
    SELECT 1 FROM event_co_hosts ech
    WHERE ech.event_id = p_event_id
      AND ech.user_id = current_setting('app.user_id', true)
  ) OR EXISTS (
    SELECT 1 FROM guests g
    WHERE g.event_id = p_event_id
      AND g.user_id = current_setting('app.user_id', true)
  );
$$;
REVOKE ALL ON FUNCTION public.app_user_can_see_event(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_user_can_see_event(TEXT) TO partyhause_app;

-- ---------------------------------------------------------------------------
-- 4b. Shared surfaces: events and their satellites
-- ---------------------------------------------------------------------------
-- events: a row is visible to its host, to any co-host, and to any guest
-- bound to it by user_id. Everything else is invisible.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_visibility ON events;
CREATE POLICY event_visibility ON events USING (
  host_id = current_setting('app.user_id', true)
  OR public.app_user_can_see_event(events.id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON events TO partyhause_app;

-- event_co_hosts: a co-host row is visible to its user and to the event's
-- host (who manages co-hosts in the UI).
ALTER TABLE event_co_hosts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cohost_visibility ON event_co_hosts;
CREATE POLICY cohost_visibility ON event_co_hosts USING (
  user_id = current_setting('app.user_id', true)
  OR public.app_user_can_see_event(event_id)
);

-- guests: an unbound guest row (user_id IS NULL) is the anonymous-RSVP seat.
-- Its email is PII and its RSVP answer is the invitee's business, so it is
-- visible only through the host's event - never to partyhause_app directly.
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guest_visibility ON guests;
CREATE POLICY guest_visibility ON guests USING (
  user_id = current_setting('app.user_id', true)
  OR public.app_user_can_see_event(event_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON guests TO partyhause_app;

-- partyboard_stickies: authored by created_by on an event; the event's host,
-- co-hosts and the author see it.
ALTER TABLE partyboard_stickies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sticky_visibility ON partyboard_stickies;
CREATE POLICY sticky_visibility ON partyboard_stickies USING (
  created_by = current_setting('app.user_id', true)
  OR public.app_user_can_see_event(event_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON partyboard_stickies TO partyhause_app;

-- partyboard_tasks: same authorship shape as stickies.
ALTER TABLE partyboard_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_visibility ON partyboard_tasks;
CREATE POLICY task_visibility ON partyboard_tasks USING (
  created_by = current_setting('app.user_id', true)
  OR public.app_user_can_see_event(event_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON partyboard_tasks TO partyhause_app;

-- polls: created_by owns the poll; voters need visibility to vote.
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS poll_visibility ON polls;
CREATE POLICY poll_visibility ON polls USING (
  created_by = current_setting('app.user_id', true)
  OR public.app_user_can_see_event(event_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON polls TO partyhause_app;

-- users: column-scoped grant (never credentials) plus table grant so the
-- scoped role can resolve its own identity. No RLS policy on users itself:
-- rows are not user-owned in the RLS sense, and the identity lookup inside
-- policies reads this table.
GRANT SELECT (id, email, name, email_verified, account_status, created_at, updated_at) ON users TO partyhause_app;

-- ---------------------------------------------------------------------------
-- 5. user_profiles: the enumeration guard
-- ---------------------------------------------------------------------------
-- This is the "already taken username" half. The display name and handle of
-- every user used to be readable by any table-granted role. Under RLS a
-- scoped session sees its own profile only; the public profile surface
-- (GET /api/users/:id) stays an API concern, authorised in application code.
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_profile ON user_profiles;
CREATE POLICY own_profile ON user_profiles USING (
  id = current_setting('app.user_id', true)
);
GRANT SELECT, INSERT, UPDATE ON user_profiles TO partyhause_app;
-- No DELETE: profile rows die with their user via cascade.

-- ---------------------------------------------------------------------------
-- 6. Cleanup and documentation
-- ---------------------------------------------------------------------------
DROP TABLE _rls_user_scoped;

COMMENT ON SCHEMA public IS
  'PartyHause. user-owned tables carry RLS with owner_scoped/event_visibility policies reading app.user_id; the API connects as the table owner (RLS not enforced); partyhause_app is the scoped role for future direct-DB clients.';
