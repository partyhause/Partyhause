-- User-chosen usernames and the onboarding state that drives the picker.
--
-- WHAT THIS CHANGES
--   Until now every handle was `u_<base36(uuid)>`, derived at signup by
--   server/routes/auth.ts:88 and changeable by nobody: no route wrote
--   `user_profiles.username`. This migration adds the columns a chosen handle
--   needs, plus the table that makes the change cooldown mean something.
--
-- WRITTEN TO RUN AGAINST A POPULATED PRODUCTION DATABASE
--   Every statement is guarded, so a partial run can be repeated without
--   manual repair, and `npm run test:migrations` replays the whole history
--   twice. The one irreversible step is the NOT NULL on
--   username_normalized, which is applied only after the backfill.
--
-- THE COLLISION PRECONDITION
--   username_normalized takes a unique index over lower(username). Existing
--   data cannot violate it: every stored handle is either u_<base36> or
--   dev_<id>, both lowercase at the point of creation, and `username` is
--   already unique. That reasoning is checked rather than trusted, both by
--   scripts/production-migration-preflight.cjs before the run and by the
--   assertion in this file, which aborts before any destructive step.
--
-- NO EXPLICIT BEGIN/COMMIT HERE, DELIBERATELY
--   The migrate engine already wraps the file in a transaction, so atomicity
--   is not what an explicit BEGIN would buy. What it costs is the precondition
--   message: once the RAISE in step 0 aborts an explicitly opened transaction,
--   every following statement fails with "current transaction is aborted" and
--   that generic text is what surfaces, burying the sentence that says which
--   rows to fix. Verified both ways against a seeded local database.

-- ---------------------------------------------------------------------------
-- 0. Precondition. Abort loudly, before altering anything, if two handles
--    differ only by case. Failing here costs nothing; failing at the unique
--    index leaves the table half-altered.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  collisions INTEGER;
BEGIN
  SELECT count(*) INTO collisions
  FROM (
    SELECT lower(username)
    FROM user_profiles
    GROUP BY lower(username)
    HAVING count(*) > 1
  ) AS duplicated;

  IF collisions > 0 THEN
    RAISE EXCEPTION
      'username_identity: % case-insensitive username collision(s) present. Resolve them before migrating; see scripts/production-migration-preflight.cjs.',
      collisions;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. New columns on user_profiles.
--
--    username_normalized is added nullable so the backfill has somewhere to
--    write before the NOT NULL lands in step 3.
-- ---------------------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS username_normalized TEXT,
  ADD COLUMN IF NOT EXISTS username_set_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS onboarding_required BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. Backfill.
--
--    2a. The normalized form of every existing handle.
--    2b. Every row that exists right now predates the picker, so its owner was
--        never offered a choice. For them the picker is a dismissible prompt,
--        not a gate. New rows take the column DEFAULT of true. This is why no
--        cutover timestamp constant is needed anywhere in the application.
--
--    Both are idempotent: 2a is a pure function of `username`, and 2b is
--    scoped by `username_set_at IS NULL`, so a replay cannot re-open the
--    picker for somebody who has since chosen a handle.
-- ---------------------------------------------------------------------------
UPDATE user_profiles
SET username_normalized = lower(username)
WHERE username_normalized IS DISTINCT FROM lower(username);

UPDATE user_profiles
SET onboarding_required = false
WHERE username_set_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Lock the column down now that every row has a value.
-- ---------------------------------------------------------------------------
ALTER TABLE user_profiles
  ALTER COLUMN username_normalized SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_username_normalized_key
  ON user_profiles (username_normalized);

-- ---------------------------------------------------------------------------
-- 4. Shape constraints on the new column, mirroring the ones
--    20260905000200_core_integrity_constraints put on `username`, plus the
--    invariant that ties the two columns together.
--
--    The third constraint is the important one: it makes it impossible for a
--    writer that bypasses server/lib/username.ts to store a normalized form
--    that disagrees with the display form, which would silently take a handle
--    out of circulation while leaving it visible as someone else's.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_username_normalized_length_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_username_normalized_length_check
      CHECK (char_length(username_normalized) BETWEEN 3 AND 30);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_username_normalized_format_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_username_normalized_format_check
      CHECK (username_normalized ~ '^[a-z0-9_]+$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_username_normalized_matches_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_username_normalized_matches_check
      CHECK (username_normalized = lower(username));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Released-handle holds.
--
--    Without this table the change cooldown protects nothing: A renames away
--    from @party and B claims it the same second, so every existing link to A
--    resolves to B. A row here keeps a released handle unclaimable by anyone
--    except its previous owner for the same 30 days the cooldown runs.
--
--    Read on the claim path and on the availability check, so it is a live
--    constraint rather than an audit log nothing consults.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS username_history (
  id                  TEXT NOT NULL DEFAULT gen_random_uuid(),
  profile_id          TEXT NOT NULL,
  username            TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  released_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT username_history_pkey PRIMARY KEY (id),
  CONSTRAINT username_history_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Covers the hold lookup exactly: filter on the normalized form, then order
-- or bound by recency.
CREATE INDEX IF NOT EXISTS username_history_username_normalized_released_at_idx
  ON username_history (username_normalized, released_at);

CREATE INDEX IF NOT EXISTS username_history_profile_id_idx
  ON username_history (profile_id);
