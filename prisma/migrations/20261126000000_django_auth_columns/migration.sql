-- Django auth columns required by django.contrib.auth ModelBackend.
--
-- Adds password, last_login, is_superuser, is_staff, is_active, date_joined
-- to users, and user_id FK to user_profiles (OneToOne from UserProfile).
-- All nullable except booleans/date_joined which carry defaults so existing
-- rows stay valid. password is populated from password_hash by the app at
-- signup/login; this migration only provisions the column.
--
-- Idempotent: safe to re-run against a database that already has some of
-- these columns (e.g. local dev databases where they were added by hand).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Django auth columns on users.
-- ---------------------------------------------------------------------------

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS "password" varchar(128),
    ADD COLUMN IF NOT EXISTS "last_login" timestamptz,
    ADD COLUMN IF NOT EXISTS "is_superuser" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "is_staff" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "date_joined" timestamptz NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- 2. user_id FK on user_profiles (UserProfile.user OneToOne).
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS "user_id" text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_profiles_user_id_fkey'
          AND conrelid = 'public.user_profiles'::regclass
    ) THEN
        ALTER TABLE public.user_profiles
            ADD CONSTRAINT user_profiles_user_id_fkey
            FOREIGN KEY ("user_id") REFERENCES public.users("id") ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "user_profiles_user_id_idx"
    ON public.user_profiles("user_id");

COMMIT;
