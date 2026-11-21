/**
 * The words on the wall, written once for both platforms.
 *
 * WHY THIS IS SHARED AND NOT TWO COMPONENTS
 *   The wall is the single highest-consequence screen in the product: it is
 *   where a user decides whether to pay. Two copies of that copy drift, and
 *   the drift is invisible because no engineer opens both platforms side by
 *   side. Shipping "3 free turns" on the web and "3 free messages" on iOS is
 *   the cheap version of that failure; shipping two different trial lengths is
 *   the expensive one.
 *
 * WHAT IS NOT HERE
 *   Layout, styling and the button. Those genuinely differ: the web has a
 *   keyboard and hover states, iOS has a sheet and a system purchase dialog.
 *   Only the strings and the trial length are shared, because only those must
 *   agree.
 *
 * WHY NO ZOD IMPORT
 *   This file is imported by both clients (web and mobile). The server uses
 *   zod schemas in @partyhause/core/contracts for validation, but the clients
 *   must not import zod. The reason values are duplicated here as a plain
 *   TypeScript union, and the test in src/test/ssot-invariants.test.ts asserts
 *   they match the server's contract.
 */

export type PaywallReason = 'free_quota_exhausted' | 'subscription_required' | 'subscription_lapsed';

/** The card-on-file trial. The only trial there is. */
export const CARD_TRIAL_DAYS = 14;

interface PaywallCopy {
  /** The heading. States what happened, not what the user did wrong. */
  title: string;
  /** One sentence of why. No more: the decision is the CTA, not the prose. */
  body: string;
  /** The primary action. */
  cta: string;
  /**
   * The way out that is not paying.
   *
   * Every wall in this product has one. The AI planner is an accelerator on
   * top of a form that still works, and a wall with no exit converts a user
   * who was not going to pay today into a user who leaves.
   */
  dismiss: string;
}

/**
 * Copy for each reason the server can give.
 *
 * The server sends a reason rather than a boolean precisely so these can
 * differ: somebody who has never trialed needs a different sentence from
 * somebody whose trial lapsed last week, and the second is the more valuable
 * conversation.
 */
const COPY: Record<PaywallReason, PaywallCopy> = {
  free_quota_exhausted: {
    title: 'You have used your free planning turns',
    body: `Start your ${CARD_TRIAL_DAYS}-day trial to keep planning with the assistant. You can still fill the form in yourself, free, always.`,
    cta: `Start ${CARD_TRIAL_DAYS}-day free trial`,
    dismiss: 'Keep going without it',
  },
  subscription_required: {
    title: 'Your trial has ended',
    body: 'Subscribe to carry on where you left off. Everything you have already planned stays exactly as it is.',
    cta: 'Subscribe',
    dismiss: 'Not now',
  },
  subscription_lapsed: {
    title: 'Your subscription lapsed',
    body: 'Your events and guests are untouched. Renew whenever you are ready.',
    cta: 'Renew',
    dismiss: 'Not now',
  },
};

/**
 * The copy for a reason.
 *
 * @param reason The server's reason, or null when the client has been walled
 *               without one, which happens if entitlement could not be read.
 * @returns Never null. An unrecognised or absent reason falls back to the
 *          quota copy, because a wall that renders no words at all is the one
 *          outcome with no recovery: the user sees a dead button.
 */
export function paywallCopy(reason: PaywallReason | null | undefined): PaywallCopy {
  if (reason && reason in COPY) return COPY[reason];
  return COPY.free_quota_exhausted;
}
