-- Onboarding event interests and marketing opt-in.
--
-- WHAT THIS MIGRATION IS
--   The interests screen of the onboarding journey ("What kind of events do
--   you love?", Birthday / Wedding / Corporate / Community / House Party /
--   Festival / Other) previously discarded its answer on BOTH clients: the
--   mobile route called a documented no-op (apps/mobile/lib/onboarding.ts,
--   "saveOnboardingData ... No-op") and the web port of the screen had no
--   persistence target at all. This adds the two columns the funnel has been
--   collecting without storing:
--
--     event_interests    the picked chips, as free strings
--     marketing_opt_in   the "Get tips and event inspiration" switch
--
--   Free strings, not a CHECK list: the chip vocabulary is a product decision
--   that changes without a migration, and the server contract already bounds
--   each entry (max 64 chars, max 20 items) in
--   packages/core/src/contracts/billing.ts. A constraint that duplicates the
--   zod would drift from it on the first vocabulary change.
--
-- WHY COLUMNS AND NOT agentic_wants
--   agentic_wants answers "which agent capabilities do you want" - RSVP
--   chasing, recap drafting - a different question with a different consumer.
--   Overloading it with event-type chips would make both answers unreadable
--   in research queries and couple the two screens' releases.
--
-- IDEMPOTENCE
--   Guarded ADD COLUMN, guarded index, guarded comment. Safe to re-run; the
--   test:migrations gate proves that by design.
--
-- RLS
--   onboarding_responses already carries ENABLE ROW LEVEL SECURITY with an
--   owner_scoped policy on user_id (20261014000000_rls_user_scoping, table
--   list line ('onboarding_responses', 'user_id')). Column additions inherit
--   the table's policy - no new grant, no new policy. The partyhause_app
--   grant is table-level (SELECT, INSERT, UPDATE, DELETE), so it already
--   covers the new columns.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'onboarding_responses'
      AND column_name = 'event_interests'
  ) THEN
    ALTER TABLE onboarding_responses ADD COLUMN event_interests TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'onboarding_responses'
      AND column_name = 'marketing_opt_in'
  ) THEN
    ALTER TABLE onboarding_responses ADD COLUMN marketing_opt_in BOOLEAN NOT NULL DEFAULT false;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS onboarding_responses_event_interests_idx
  ON onboarding_responses USING GIN (event_interests);

COMMENT ON COLUMN onboarding_responses.event_interests IS
  'Event-type chips picked on the onboarding interests screen (max 20 x 64 chars, bounded by the zod contract, not the database).';
COMMENT ON COLUMN onboarding_responses.marketing_opt_in IS
  '"Get tips and event inspiration" switch from the onboarding profile screen. False is the default and the absence of consent.';
