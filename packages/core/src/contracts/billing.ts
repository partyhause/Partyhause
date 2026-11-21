/**
 * Entitlement and onboarding-research contracts.
 *
 * Transcribed from the CHECK constraints in
 * prisma/migrations/20260913120000_billing_and_onboarding, not from the
 * TypeScript. The database decides what a status may be; a schema that permits
 * a value Postgres refuses is a 500 waiting for the first webhook that carries
 * it.
 *
 * WHAT IS DELIBERATELY ABSENT
 *   No provider identifiers. `stripe_customer_id`, `stripe_subscription_id`
 *   and `apple_original_transaction_id` are on the row and never leave the
 *   server. A client has no use for them, and a customer id in a client bundle
 *   is an enumeration surface for the provider's own API.
 */

import { z } from 'zod';
import { isoDateTime } from './primitives';

/** CHECK subscriptions_plan_check. */
export const subscriptionPlan = z.enum(['free', 'creator', 'vendor']);

/** CHECK subscriptions_status_check. */
export const subscriptionStatus = z.enum([
  'none',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
]);

/** CHECK subscriptions_source_check. */
export const subscriptionSource = z.enum(['none', 'stripe', 'apple']);

/**
 * Why the paywall is up.
 *
 * Specific rather than a single `blocked`, because it is what selects the
 * copy. "Your free turns are gone, start a trial" and "your subscription
 * lapsed, update your card" are different messages with different actions, and
 * showing the wrong one reads as the product not knowing who you are.
 */
export const paywallReason = z.enum([
  'free_quota_exhausted',
  'subscription_required',
  'subscription_lapsed',
]);

/** The answer from `GET /api/billing/entitlement`. */
export const entitlementView = z.object({
  plan: subscriptionPlan,
  status: subscriptionStatus,
  source: subscriptionSource,
  /** True when the paid feature set is open, for any reason. */
  is_entitled: z.boolean(),
  /**
   * The single boolean a client gates the planner on.
   *
   * Computed server-side from six fields and the clock. Clients must not
   * re-derive it: the failure modes are giving the product away and locking
   * out a paying customer.
   */
  can_use_ai: z.boolean(),
  trial_ends_at: isoDateTime.nullable(),
  /** Whole days, floored. Presentational only. */
  trial_days_remaining: z.number().int().nullable(),
  cancel_at_period_end: z.boolean(),
  ai: z.object({
    /** Billable turns consumed. Heuristic replies never count. */
    used: z.number().int(),
    limit: z.number().int(),
    remaining: z.number().int(),
  }),
  paywall: z.object({
    show: z.boolean(),
    reason: paywallReason.nullable(),
  }),
  can_start: z.object({
    card_14d: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Onboarding research
// ---------------------------------------------------------------------------

/** CHECK onboarding_responses_autonomy_check. */
export const autonomyLevel = z.enum([
  /** Tell me what you would do. */
  'suggest',
  /** Write it, I will send it. */
  'draft',
  /** Do it, but ask first. */
  'act_with_approval',
  /** Do it and tell me afterwards. */
  'act_autonomously',
]);

export const organizerType = z.enum(['personal', 'professional', 'corporate', 'community']);
export const eventsPerYear = z.enum(['1-2', '3-10', '11-50', '50+']);
export const typicalGuestCount = z.enum(['under-20', '20-50', '51-150', 'over-150']);

/**
 * A partial answer set.
 *
 * Every field optional, because the flow spans several screens and a user can
 * leave at any point. What they told us before leaving is worth keeping: a
 * half-finished response is research, and discarding it to keep the model tidy
 * would throw away the most interesting rows, the ones from people who
 * dropped out.
 */
export const onboardingAnswers = z.object({
  organizer_type: organizerType.optional(),
  events_per_year: eventsPerYear.optional(),
  typical_guest_count: typicalGuestCount.optional(),
  ai_before: z.array(z.string().max(64)).max(20).optional(),
  ai_during: z.array(z.string().max(64)).max(20).optional(),
  ai_after: z.array(z.string().max(64)).max(20).optional(),
  autonomy_level: autonomyLevel.optional(),
  agentic_wants: z.array(z.string().max(64)).max(20).optional(),
  biggest_pain: z.string().max(500).optional(),
  /** Event-type chips from the onboarding interests screen. */
  event_interests: z.array(z.string().max(64)).max(20).optional(),
  /** The "Get tips and event inspiration" switch. */
  marketing_opt_in: z.boolean().optional(),
  /** Set by the final screen. Absent means "saving progress". */
  completed: z.boolean().optional(),
});

/** The stored response, as `GET /api/onboarding/responses` returns it. */
export const onboardingResponse = z.object({
  schema_version: z.string(),
  organizer_type: organizerType.nullable(),
  events_per_year: eventsPerYear.nullable(),
  typical_guest_count: typicalGuestCount.nullable(),
  ai_before: z.array(z.string()),
  ai_during: z.array(z.string()),
  ai_after: z.array(z.string()),
  autonomy_level: autonomyLevel.nullable(),
  agentic_wants: z.array(z.string()),
  biggest_pain: z.string().nullable(),
  event_interests: z.array(z.string()),
  marketing_opt_in: z.boolean(),
  completed_at: isoDateTime.nullable(),
});

export type SubscriptionPlan = z.infer<typeof subscriptionPlan>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatus>;
export type SubscriptionSource = z.infer<typeof subscriptionSource>;

/** Stripe Price IDs for each plan. Configured in Stripe Dashboard. */
export const STRIPE_PRICE_IDS: Record<Exclude<SubscriptionPlan, 'free'>, string> = {
  creator: process.env.STRIPE_PRICE_CREATOR ?? '',
  vendor: process.env.STRIPE_PRICE_VENDOR ?? '',
};

/**
 * The card-on-file trial. The only trial there is.
 *
 * A 7-day no-card trial was designed alongside this and cut: the onboarding
 * paywall is hard, and a free path beside it makes it soft.
 *
 * Lives in the contract rather than on the server because the client has to
 * render the number before it has ever called the API, so it cannot be
 * fetched. A client promising 14 days against a server granting 7 is a
 * chargeback, not a display bug.
 */
export const CARD_TRIAL_DAYS = 14;

/** Request to create a Stripe Checkout session for subscription. */
export const createCheckoutSessionRequest = z.object({
  /** Plan to subscribe to. */
  plan: z.enum(['creator', 'vendor']),
  /** Optional success URL override. Defaults to app setting. */
  success_url: z.string().url().optional(),
  /** Optional cancel URL override. Defaults to app setting. */
  cancel_url: z.string().url().optional(),
});

export type CreateCheckoutSessionRequest = z.infer<typeof createCheckoutSessionRequest>;

/** Response from creating a Checkout session. */
export const createCheckoutSessionResponse = z.object({
  /** Stripe Checkout session ID. */
  session_id: z.string(),
  /** URL to redirect the user to. */
  url: z.string().url(),
});

export type CreateCheckoutSessionResponse = z.infer<typeof createCheckoutSessionResponse>;

/** Request to create a Stripe Billing Portal session. */
export const createPortalSessionRequest = z.object({
  /** Optional return URL override. Defaults to app setting. */
  return_url: z.string().url().optional(),
});

export type CreatePortalSessionRequest = z.infer<typeof createPortalSessionRequest>;

/** Response from creating a Billing Portal session. */
export const createPortalSessionResponse = z.object({
  /** URL to redirect the user to. */
  url: z.string().url(),
});

export type CreatePortalSessionResponse = z.infer<typeof createPortalSessionResponse>;

export type PaywallReason = z.infer<typeof paywallReason>;
export type EntitlementView = z.infer<typeof entitlementView>;
export type AutonomyLevel = z.infer<typeof autonomyLevel>;
export type OrganizerType = z.infer<typeof organizerType>;
export type EventsPerYear = z.infer<typeof eventsPerYear>;
export type TypicalGuestCount = z.infer<typeof typicalGuestCount>;
export type OnboardingAnswers = z.infer<typeof onboardingAnswers>;
export type OnboardingResponse = z.infer<typeof onboardingResponse>;
