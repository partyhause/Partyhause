/**
 * What a user is allowed to do, and why.
 *
 * ENTITLEMENT IS A PROJECTION, NOT A STORED FLAG
 *   There is no `is_entitled` column. It is computed here from `status`,
 *   `trial_ends_at` and `current_period_end` against the current instant. A
 *   stored boolean is a cache of a time-dependent fact, and it goes stale
 *   silently: a trial that ends at 03:00 would keep granting access until
 *   something happened to rewrite the row, and nothing does at 03:00.
 *
 * ONE BOOLEAN, COMPUTED SERVER-SIDE
 *   Both clients read `can_use_ai` rather than deriving it from six fields.
 *   That rule is already load-bearing elsewhere in this API: the onboarding
 *   picker computes `show_picker` server-side for exactly this reason
 *   (server/routes/users.ts:312-315). Two clients deriving the same boolean
 *   from the same fields is two chances to derive it differently, and here the
 *   failure modes are "gave the product away" and "locked out a paying
 *   customer".
 *
 * THE PURE FUNCTION IS THE UNIT UNDER TEST
 *   `computeEntitlement` performs no I/O and takes the clock as an argument,
 *   so every state of the machine is reachable in a test without a database
 *   or a fake timer.
 */

// ---------------------------------------------------------------------------
// The wire shape is owned by the contract, not redeclared here.
//
// `EntitlementView`, `SubscriptionStatus`, `SubscriptionSource` and
// `PaywallReason` were declared in this file AND inferred from zod in
// packages/core/src/contracts/billing.ts. Two declarations of one wire shape
// with nothing pinning them together is the exact defect this architecture
// exists to remove: they typecheck independently, so a field added to one and
// not the other is invisible until a client reads undefined.
//
// Importing the inferred types makes the duplication structurally impossible
// rather than merely tested for. The contract is transcribed from the CHECK
// constraints, so the database remains the root of the chain.
//
// The `/contracts` subpath, not the package root: the root barrel re-exports
// the HTTP transport, which uses DOM types this tsconfig has no lib for.
// ---------------------------------------------------------------------------
import type {
  EntitlementView,
  PaywallReason,
  SubscriptionSource,
  SubscriptionStatus,
} from '@partyhause/core/contracts/billing';

export type { EntitlementView, PaywallReason, SubscriptionSource, SubscriptionStatus };

/** Model turns a user gets before anything is required of them. Lifetime. */
export const FREE_AI_TURNS = 3;

/**
 * The card-on-file trial. Re-exported, not redeclared.
 *
 * The number is owned by `@partyhause/core/contracts/billing` because both clients
 * must render it before they have called anything. Two declarations of one
 * trial length is a chargeback waiting to happen.
 */
import { CARD_TRIAL_DAYS } from '@partyhause/core/contracts/billing';
export { CARD_TRIAL_DAYS };

const MS_PER_DAY = 24 * 60 * 60 * 1000;




/** The subset of a `subscriptions` row the projection needs. */
export interface SubscriptionFacts {
  plan: string;
  status: string;
  source: string;
  card_trial_started_at: Date | null;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  /** Null means money has never been taken from this account. */
  first_paid_at: Date | null;
}


/**
 * A user with no `subscriptions` row.
 *
 * Every account predating this feature is in exactly this state, and signup
 * does not create a row either. Requiring one would mean a backfill and a new
 * failure mode; treating absence as the free default means there is nothing to
 * migrate and no row to be missing.
 */
export const NO_SUBSCRIPTION: SubscriptionFacts = {
  plan: 'free',
  status: 'none',
  source: 'none',
  card_trial_started_at: null,
  trial_ends_at: null,
  current_period_end: null,
  cancel_at_period_end: false,
  first_paid_at: null,
};

/** True when `at` is a usable future instant. */
function isFuture(at: Date | null, now: Date): boolean {
  if (!at) return false;
  const time = at.getTime();
  return Number.isFinite(time) && time > now.getTime();
}

/**
 * Whole days between now and an instant, floored, minimum zero.
 *
 * Floored rather than rounded so "1 day left" never appears with 30 minutes
 * remaining. A user told they have a day and then cut off in half an hour has
 * been misled by the rounding, not by the policy.
 */
function daysRemaining(at: Date | null, now: Date): number | null {
  if (!at) return null;
  const delta = at.getTime() - now.getTime();
  if (!Number.isFinite(delta)) return null;
  return Math.max(0, Math.floor(delta / MS_PER_DAY));
}

/**
 * Decide what a user may do.
 *
 * @param facts The subscription row, or {@link NO_SUBSCRIPTION} when absent.
 * @param billableAiTurns Count of `ai_usage` rows with `source = 'llm'`.
 *        Heuristic turns are excluded by the caller, because the deterministic
 *        fallback costs nothing and charging for it would bill for an answer
 *        the model never produced.
 * @param now Reference instant, injectable so the state machine is testable.
 * @returns The full view. Never throws.
 *
 * Complexity: O(1). No I/O.
 */
export function computeEntitlement(
  facts: SubscriptionFacts,
  billableAiTurns: number,
  now: Date = new Date(),
): EntitlementView {
  const status = facts.status as SubscriptionStatus;

  // `past_due` still grants access until the period already paid for runs out.
  // Stripe keeps a subscription in this state while it retries, and the
  // failure was for the NEXT period: cutting someone off the moment a renewal
  // card declines punishes them for a bank's decision and converts a dunning
  // email into a support ticket.
  const inPaidPeriod = status === 'past_due' && isFuture(facts.current_period_end, now);
  const inTrial = status === 'trialing' && isFuture(facts.trial_ends_at, now);
  const isEntitled = status === 'active' || inTrial || inPaidPeriod;

  const used = Math.max(0, billableAiTurns);
  const remaining = Math.max(0, FREE_AI_TURNS - used);
  const canUseAi = isEntitled || remaining > 0;

  // Eligibility is "never started", not "not currently running". The trial is
  // once per account, forever, which is what the nullable timestamp records.
  // Otherwise a user cycles the same free fortnight indefinitely.
  const canStartCard = facts.card_trial_started_at === null && status !== 'active';

  return {
    // Cast, consistently with `status` and `source` below. These three are
    // TEXT columns guarded by CHECK constraints
    // (subscriptions_plan_check, _status_check, _source_check), so the
    // database is what guarantees the vocabulary and the contract enums are
    // transcribed from those same constraints. src/test/entitlement.test.ts
    // asserts that correspondence against the migration SQL, so a cast here
    // cannot silently widen: the enum and the constraint are compared.
    plan: facts.plan as EntitlementView['plan'],
    status,
    source: facts.source as SubscriptionSource,
    is_entitled: isEntitled,
    can_use_ai: canUseAi,
    trial_ends_at: inTrial && facts.trial_ends_at ? facts.trial_ends_at.toISOString() : null,
    trial_days_remaining: inTrial ? daysRemaining(facts.trial_ends_at, now) : null,
    cancel_at_period_end: facts.cancel_at_period_end,
    ai: { used, limit: FREE_AI_TURNS, remaining },
    paywall: {
      show: !canUseAi,
      reason: canUseAi ? null : paywallReason(facts, status),
    },
    can_start: { card_14d: canStartCard },
  };
}

/**
 * Why the wall is up.
 *
 * Only called when access is already denied. Ordered most-specific first, so
 * the copy a user sees names their actual situation rather than the first
 * condition that happens to match.
 */
function paywallReason(facts: SubscriptionFacts, status: SubscriptionStatus): PaywallReason {
  void status;

  // Money was taken at some point and access has now stopped. This is the
  // only branch that may say "your subscription ended", and it keys on
  // `first_paid_at` rather than on the trial columns: a card trial that
  // lapsed without converting sets `card_trial_started_at` too, and telling
  // someone their subscription ended when they never had one is both wrong
  // and a support ticket.
  if (facts.first_paid_at !== null) return 'subscription_lapsed';

  // The trial is spent and never converted. Only a purchase opens this now.
  if (facts.card_trial_started_at !== null) return 'subscription_required';

  return 'free_quota_exhausted';
}

/**
 * The instant a trial of the given kind should end.
 *
 * @param startedAt When it starts, normally now.
 */
export function trialEndsAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + CARD_TRIAL_DAYS * MS_PER_DAY);
}
