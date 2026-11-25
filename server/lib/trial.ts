/**
 * Starting the one trial there is.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE
 *   Until now nothing in the codebase could write `subscriptions.status`. The
 *   projection could compute entitlement, the funnel could demand it, and the
 *   paywall could offer a trial, but no code path set the row. Every user who
 *   reached screen four was stuck there permanently while the API told them a
 *   trial was available. A state machine with no transition into its accepting
 *   state is not a state machine.
 *
 * ONCE PER ACCOUNT, FOREVER
 *   `card_trial_started_at` is the record. Non-null means spent, whether or
 *   not the trial is still running and whether or not it converted. Checking
 *   "is a trial running" instead would let a user cycle the same free
 *   fortnight indefinitely, which is the most obvious way to lose the entire
 *   paid tier.
 *
 * IDEMPOTENT BY THE ROW, NOT BY A KEY
 *   `/api/mvp` writes carry an `Idempotency-Key` because they create rows that
 *   can legitimately repeat: two guests can share a name. A trial cannot. The
 *   uniqueness is already in the data, on `subscriptions.user_id`, so a
 *   repeated start is answered from the row rather than from a command ledger.
 *   A double-tapped button must not produce two trials, and must not produce
 *   an error either: the user asked for a trial and they have one.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { CARD_TRIAL_DAYS, trialEndsAt } from './entitlement';

/** Why a trial could not be started. Stable, and selects the client's copy. */
export type TrialRejection =
  /** Already used, whether or not it converted. One per account, forever. */
  | 'TRIAL_ALREADY_USED'
  /** Already paying. Starting a trial would be a downgrade, not a favour. */
  | 'ALREADY_SUBSCRIBED';

export interface TrialStartResult {
  ok: boolean;
  /** Set when ok. ISO instant the trial ends. */
  trialEndsAt: string | null;
  /** True when the caller already had this exact trial running. */
  alreadyRunning: boolean;
  code: TrialRejection | null;
  message: string | null;
}

function reject(code: TrialRejection, message: string): TrialStartResult {
  return { ok: false, trialEndsAt: null, alreadyRunning: false, code, message };
}

/**
 * Start the card trial for one account.
 *
 * Runs inside a transaction that locks the subscription row, so two concurrent
 * requests cannot both observe "no trial yet" and both start one. The row is
 * created on demand: signup does not write a subscription, and every account
 * predating billing has none, so absence is the normal starting state rather
 * than an error.
 *
 * @param database Prisma client, injectable for tests.
 * @param userId The authenticated caller.
 * @param now Reference instant, injectable for tests.
 * @returns The outcome. Never throws for an expected refusal.
 *
 * Complexity: one locked read and one write, both on the unique index over
 * `user_id`. Blocking I/O.
 */
export async function startCardTrial(
  database: Pick<PrismaClient, '$transaction'>,
  userId: string,
  now: Date = new Date(),
): Promise<TrialStartResult> {
  return database.$transaction(async (tx) => {
    // SELECT ... FOR UPDATE on the account's row. Without it, two requests can
    // both read "never trialed" and both write, which spends one trial twice
    // and leaves whichever lost the race with an end date it did not choose.
    // The same lock shape `createDeletionIntent` uses on `users`.
    const locked = await tx.$queryRaw<
      Array<{ status: string; card_trial_started_at: Date | null; trial_ends_at: Date | null }>
    >`
      SELECT status, card_trial_started_at, trial_ends_at
      FROM subscriptions
      WHERE user_id = ${userId}
      FOR UPDATE
    `;

    const existing = locked[0] ?? null;

    if (existing?.status === 'active') {
      return reject(
        'ALREADY_SUBSCRIBED',
        'This account already has an active subscription.',
      );
    }

    if (existing?.card_trial_started_at) {
      // Answer from the row rather than erroring when the trial they asked for
      // is the one already running: a double-tapped button is not a fault.
      const stillRunning =
        existing.status === 'trialing' &&
        existing.trial_ends_at !== null &&
        existing.trial_ends_at.getTime() > now.getTime();

      if (stillRunning) {
        return {
          ok: true,
          trialEndsAt: existing.trial_ends_at!.toISOString(),
          alreadyRunning: true,
          code: null,
          message: null,
        };
      }

      return reject(
        'TRIAL_ALREADY_USED',
        `This account has already used its ${CARD_TRIAL_DAYS}-day trial.`,
      );
    }

    const endsAt = trialEndsAt(now);

    // `plan: 'creator'` and `status: 'trialing'` together, because
    // subscriptions_trialing_needs_end_check refuses a trialing row with no
    // trial_ends_at. A row that claimed to be trialing with no end would be
    // entitled forever, since the projection compares that column to now().
    //
    // 'creator', not the retired 'pro': subscriptions_plan_check only admits
    // ('free', 'creator', 'vendor'), and the card trial is the creator-tier
    // trial. Rows written as 'pro' before the rename are backfilled by
    // migration 20260922000000_subscription_plan_values.
    //
    // `source` stays 'none': no provider is involved yet. Stripe sets it when
    // a payment method is attached, which is a later phase. Setting it here
    // would claim a provider relationship that does not exist.
    const data = {
      plan: 'creator',
      status: 'trialing',
      card_trial_started_at: now,
      trial_ends_at: endsAt,
    } satisfies Prisma.SubscriptionUpdateInput;

    await tx.subscription.upsert({
      where: { user_id: userId },
      update: data,
      create: { user_id: userId, source: 'none', ...data },
    });

    return {
      ok: true,
      trialEndsAt: endsAt.toISOString(),
      alreadyRunning: false,
      code: null,
      message: null,
    };
  });
}
