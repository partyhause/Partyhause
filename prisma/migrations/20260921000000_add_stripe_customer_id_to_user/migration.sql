-- Add stripe_customer_id to users table for Stripe integration
--
-- This column stores the Stripe customer ID for each user, enabling
-- subscription management and billing portal access.
--
-- Idempotent (IF NOT EXISTS), matching the guarded style of the other
-- migrations: enrollment and test:migrations replay files, and a second
-- application must be a no-op rather than a failure.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_stripe_customer_id_key" ON "users"("stripe_customer_id");
