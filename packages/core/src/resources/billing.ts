/**
 * Entitlement and the trial, for both clients.
 *
 * WHY THIS RESOURCE EXISTS
 *   `/api/billing` was mounted and complete with zero callers on either
 *   platform, and `packages/core` had no way to reach it, so the iOS app could
 *   not read entitlement at all. A paywall that one client cannot evaluate is
 *   a paywall that client does not have.
 *
 * THE CLIENT DOES NOT DECIDE ANYTHING
 *   `can_use_ai`, `paywall.show` and `paywall.reason` are computed server-side
 *   from six fields and the clock. Clients render them. Re-deriving any of
 *   them here would be two implementations of one rule, and the failure modes
 *   are giving the product away and locking out somebody who has paid.
 */

import type { Transport, ApiResponse } from '../http/transport';
import type { EntitlementView } from '../types';

/** The answer from `POST /api/billing/trial/start`. */
export interface TrialStartResponse {
  /** ISO instant the trial ends. */
  trial_ends_at: string;
  /** True when the caller already had this trial running. Not an error. */
  already_running: boolean;
  /** The freshly computed view, so the client need not re-fetch. */
  entitlement: EntitlementView;
}

export interface BillingResource {
  /**
   * What the caller is entitled to, right now.
   *
   * Recomputed against the clock on every call, so a trial that lapsed a
   * minute ago is reported as lapsed. There is nothing cacheable here beyond
   * the length of a render.
   */
  entitlement(): Promise<ApiResponse<EntitlementView>>;

  /**
   * Start the card trial. Once per account, forever.
   *
   * Takes no arguments: the trial has one length and one kind, so there is
   * nothing for a caller to choose.
   *
   * A repeat call while the trial is running answers 200 with
   * `already_running: true` rather than an error, because a double-tapped
   * button is not a fault. A call after the trial has been used answers 409
   * `TRIAL_ALREADY_USED`, and an active subscriber gets 409
   * `ALREADY_SUBSCRIBED`.
   */
  startTrial(): Promise<ApiResponse<TrialStartResponse>>;
}

export function createBillingResource(t: Transport): BillingResource {
  return {
    // Not unwrapped: the route answers with the view itself.
    entitlement: () => t.request<EntitlementView>('/api/billing/entitlement', { method: 'GET' }),
    startTrial: () =>
      t.request<TrialStartResponse>('/api/billing/trial/start', { method: 'POST' }),
  };
}
