-- Widen subscriptions.plan from ('free', 'pro') to ('free', 'creator', 'vendor').
--
-- The paid tier renamed 'pro' to the creator/vendor split (the zod contract in
-- packages/core/src/contracts/billing.ts is transcribed FROM these CHECKs).
-- Editing 20260913120000_billing_and_onboarding in place is not an option:
-- that migration already ran in production, and Prisma refuses a re-deploy
-- when an applied migration file changed. So the rename lands here instead.
--
-- Order matters: backfill first, then replace the constraint, or ADD
-- CONSTRAINT fails on any row still holding 'pro' (startCardTrial wrote it
-- until this change). Guarded throughout so a partial run can be repeated.

UPDATE subscriptions SET plan = 'creator' WHERE plan = 'pro';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_plan_check') THEN
    ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_plan_check;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_plan_check') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check
      CHECK (plan IN ('free', 'creator', 'vendor'));
  END IF;
END $$;
