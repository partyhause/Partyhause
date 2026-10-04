-- Billing, metering and onboarding research.
--
-- WHAT THIS ADDS
--   subscriptions          one row per user, the facts a provider told us
--   ai_usage               append-only model turns, for the lifetime quota
--   billing_events         webhook ledger, at-least-once made idempotent
--   onboarding_responses   what the user said about how they run events
--
-- ADDITIVE ONLY. No existing table is altered and no column is dropped, so
-- the API running before this migration keeps working after it. That is
-- deliberate: the entitlement gate is not enforced until a later change, and
-- this one must be safe to apply well ahead of it.
--
-- NO EXPLICIT BEGIN/COMMIT, for the reason recorded in
-- 20260913000000_username_identity: the migrate engine already wraps the file
-- in a transaction, and an explicit BEGIN buries a RAISE behind "current
-- transaction is aborted" so the precondition message never surfaces.
--
-- FK TYPE NOTE
--   user_id is TEXT, not uuid. Every user FK in this schema is TEXT holding
--   gen_random_uuid() output (see the convention note at schema.prisma:12-15),
--   and comparing one to a uuid fails with
--   "operator does not exist: text = uuid".

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                            TEXT NOT NULL DEFAULT gen_random_uuid(),
  user_id                       TEXT NOT NULL,
  plan                          TEXT NOT NULL DEFAULT 'free',
  status                        TEXT NOT NULL DEFAULT 'none',
  source                        TEXT NOT NULL DEFAULT 'none',
  card_trial_started_at         TIMESTAMP(3),
  trial_ends_at                 TIMESTAMP(3),
  current_period_end            TIMESTAMP(3),
  cancel_at_period_end          BOOLEAN NOT NULL DEFAULT false,
  -- The only fact separating "your subscription ended" from "your trial
  -- ended". Not inferable: card_trial_started_at is set when a trial begins,
  -- and Stripe sets current_period_end during a trial as well.
  first_paid_at                 TIMESTAMP(3),
  stripe_customer_id            TEXT,
  stripe_subscription_id        TEXT,
  apple_original_transaction_id TEXT,
  revision                      INTEGER NOT NULL DEFAULT 1,
  created_at                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key ON subscriptions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_key ON subscriptions (stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_key ON subscriptions (stripe_subscription_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_apple_original_transaction_id_key ON subscriptions (apple_original_transaction_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status);
CREATE INDEX IF NOT EXISTS subscriptions_trial_ends_at_idx ON subscriptions (trial_ends_at);

-- ---------------------------------------------------------------------------
-- ai_usage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage (
  id         TEXT NOT NULL DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  source     TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT ai_usage_pkey PRIMARY KEY (id),
  CONSTRAINT ai_usage_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- The quota query is exactly (user_id, source), so the index covers it.
CREATE INDEX IF NOT EXISTS ai_usage_user_id_source_idx ON ai_usage (user_id, source);
CREATE INDEX IF NOT EXISTS ai_usage_user_id_created_at_idx ON ai_usage (user_id, created_at);

-- ---------------------------------------------------------------------------
-- billing_events
--
-- No FK to users. A dispute or a refund notification can arrive after the
-- account is deleted, and the evidence has to survive that. This mirrors the
-- reasoning already applied to account_deletion_requests.user_id, which is
-- likewise relation-free (schema.prisma:1391).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_events (
  id                TEXT NOT NULL DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  payload_hash      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  error             TEXT,
  received_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at        TIMESTAMP(3),

  CONSTRAINT billing_events_pkey PRIMARY KEY (id)
);

-- This unique index IS the idempotency guarantee. A redelivered webhook
-- conflicts here and is skipped rather than applied twice.
CREATE UNIQUE INDEX IF NOT EXISTS billing_events_provider_provider_event_id_key
  ON billing_events (provider, provider_event_id);
CREATE INDEX IF NOT EXISTS billing_events_status_received_at_idx
  ON billing_events (status, received_at);

-- ---------------------------------------------------------------------------
-- onboarding_responses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_responses (
  id                  TEXT NOT NULL DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  schema_version      TEXT NOT NULL,
  organizer_type      TEXT,
  events_per_year     TEXT,
  typical_guest_count TEXT,
  ai_before           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ai_during           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ai_after            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  autonomy_level      TEXT,
  agentic_wants       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  biggest_pain        TEXT,
  completed_at        TIMESTAMP(3),
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT onboarding_responses_pkey PRIMARY KEY (id),
  CONSTRAINT onboarding_responses_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_responses_user_id_key ON onboarding_responses (user_id);
CREATE INDEX IF NOT EXISTS onboarding_responses_completed_at_idx ON onboarding_responses (completed_at);
CREATE INDEX IF NOT EXISTS onboarding_responses_organizer_type_idx ON onboarding_responses (organizer_type);

-- ---------------------------------------------------------------------------
-- Vocabulary constraints.
--
-- Guarded so a partial run can be repeated. These are the same shape as the
-- CHECKs the rest of the schema uses, and they are what the zod contracts in
-- packages/core/src/contracts/billing.ts are transcribed FROM, not the other
-- way round.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_plan_check') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check
      CHECK (plan IN ('free', 'pro'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN ('none', 'trialing', 'active', 'past_due', 'canceled', 'expired'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_source_check') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_source_check
      CHECK (source IN ('none', 'stripe', 'apple'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_revision_check') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_revision_check
      CHECK (revision >= 1);
  END IF;

  -- A trial must have an end. A row claiming 'trialing' with no
  -- trial_ends_at would be entitled forever, because the projection compares
  -- that column against now().
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_trialing_needs_end_check') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_trialing_needs_end_check
      CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_source_check') THEN
    ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_source_check
      CHECK (source IN ('llm', 'heuristic'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_events_provider_check') THEN
    ALTER TABLE billing_events ADD CONSTRAINT billing_events_provider_check
      CHECK (provider IN ('stripe', 'apple'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_events_status_check') THEN
    ALTER TABLE billing_events ADD CONSTRAINT billing_events_status_check
      CHECK (status IN ('pending', 'applied', 'ignored', 'failed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_responses_autonomy_check') THEN
    ALTER TABLE onboarding_responses ADD CONSTRAINT onboarding_responses_autonomy_check
      CHECK (autonomy_level IS NULL OR autonomy_level IN ('suggest', 'draft', 'act_with_approval', 'act_autonomously'));
  END IF;
END
$$;
