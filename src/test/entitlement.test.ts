/**
 * The entitlement state machine.
 *
 * WHY THIS IS EXHAUSTIVE
 *   Every branch here is a commercial decision with a money-shaped failure on
 *   each side. Getting it wrong in one direction gives the product away; in
 *   the other it locks out somebody who has paid. Neither surfaces as an
 *   exception, so neither would be caught by anything except a test that
 *   walks the states deliberately.
 *
 *   `computeEntitlement` takes the clock as an argument and performs no I/O
 *   precisely so every state is reachable here without a database or a fake
 *   timer.
 *
 * THE VOCABULARY IS CHECKED AGAINST THE DATABASE, NOT AGAINST ITSELF
 *   The status and plan enums are compared to the CHECK constraints in the
 *   migration SQL rather than to a second list written here, which would be
 *   the same drift this codebase already paid for once.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CARD_TRIAL_DAYS,
  FREE_AI_TURNS,
  NO_SUBSCRIPTION,
  computeEntitlement,
  trialEndsAt,
  type SubscriptionFacts,
} from '../../server/lib/entitlement';
import { subscriptionStatus, subscriptionPlan, subscriptionSource } from '../../packages/core/src/contracts';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'prisma/migrations/20260913120000_billing_and_onboarding/migration.sql'),
  'utf8',
);
// The plan vocabulary moved: the billing migration shipped ('free', 'pro')
// and renaming an applied migration is refused by Prisma, so the rename to
// ('free', 'creator', 'vendor') lives in its own migration. The live CHECK is
// the one in the later file, which is what the contract is compared against.
const PLAN_MIGRATION = fs.readFileSync(
  path.join(ROOT, 'prisma/migrations/20260922000000_subscription_plan_values/migration.sql'),
  'utf8',
);

const NOW = new Date('2026-06-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

function facts(over: Partial<SubscriptionFacts> = {}): SubscriptionFacts {
  return { ...NO_SUBSCRIPTION, ...over };
}

/** Values from a named CHECK ... IN (...) constraint in the given migration SQL. */
function checkValues(source: string, constraint: string): string[] {
  const at = source.indexOf(`ADD CONSTRAINT ${constraint}`);
  expect(at, `${constraint} not found in the migration`).toBeGreaterThan(-1);
  const inList = source.slice(at, at + 400).match(/IN\s*\(([^)]*)\)/i);
  expect(inList).not.toBeNull();
  return inList![1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
}

describe('contract vocabulary matches the database', () => {
  it.each([
    ['subscriptions_status_check', MIGRATION, subscriptionStatus],
    ['subscriptions_plan_check', PLAN_MIGRATION, subscriptionPlan],
    ['subscriptions_source_check', MIGRATION, subscriptionSource],
  ] as [string, string, typeof subscriptionStatus][])('%s', (constraint, source, schema) => {
    expect([...(schema.options as string[])].sort()).toEqual([...checkValues(source, constraint)].sort());
  });
});

describe('a brand new user', () => {
  it('may use the planner without paying anything', () => {
    const view = computeEntitlement(facts(), 0, NOW);
    expect(view.can_use_ai).toBe(true);
    expect(view.is_entitled).toBe(false);
    expect(view.ai).toEqual({ used: 0, limit: FREE_AI_TURNS, remaining: FREE_AI_TURNS });
    expect(view.paywall).toEqual({ show: false, reason: null });
  });

  it('needs no subscription row to exist', () => {
    // Every account created before this feature has none, and signup does not
    // write one. Absence must mean "free, never trialed", not an error, or the
    // feature needs a backfill it should not need.
    expect(() => computeEntitlement(NO_SUBSCRIPTION, 0, NOW)).not.toThrow();
  });

  it('is walled at exactly the limit, not before and not after', () => {
    expect(computeEntitlement(facts(), FREE_AI_TURNS - 1, NOW).can_use_ai).toBe(true);
    expect(computeEntitlement(facts(), FREE_AI_TURNS, NOW).can_use_ai).toBe(false);
  });

  it('is walled with a reason the copy can use', () => {
    const view = computeEntitlement(facts(), FREE_AI_TURNS, NOW);
    expect(view.paywall).toEqual({ show: true, reason: 'free_quota_exhausted' });
    expect(view.can_start.card_14d).toBe(true);
  });

  it('cannot go negative on remaining, however the count arrives', () => {
    // A concurrent write could record a turn between the gate and the count.
    expect(computeEntitlement(facts(), 99, NOW).ai.remaining).toBe(0);
    expect(computeEntitlement(facts(), -5, NOW).ai.used).toBe(0);
  });
});

describe('trials', () => {
  it('a running trial entitles, and reports the days left floored', () => {
    const view = computeEntitlement(
      facts({ status: 'trialing', trial_ends_at: new Date(NOW.getTime() + 3.9 * DAY) }),
      FREE_AI_TURNS,
      NOW,
    );
    expect(view.is_entitled).toBe(true);
    expect(view.can_use_ai).toBe(true);
    // Floored, not rounded: "1 day left" must never appear with 30 minutes to
    // go, or the user has been misled by the arithmetic rather than the policy.
    expect(view.trial_days_remaining).toBe(3);
  });

  it('expires exactly at the boundary', () => {
    const endsAt = inDays(1);
    expect(computeEntitlement(facts({ status: 'trialing', trial_ends_at: endsAt }), 3, new Date(endsAt.getTime() - 1)).is_entitled).toBe(true);
    expect(computeEntitlement(facts({ status: 'trialing', trial_ends_at: endsAt }), 3, endsAt).is_entitled).toBe(false);
  });

  it('the trial is once per account, forever', () => {
    // Eligibility is "never started", not "not currently running". Otherwise a
    // user cycles the same free fortnight indefinitely.
    // Both trials spent and never converted: they owe us nothing and have
    // never paid, so the copy must say "subscribe", not "your subscription
    // ended".
    const spent = facts({
      status: 'expired',
      card_trial_started_at: inDays(-20),
      first_paid_at: null,
    });
    const view = computeEntitlement(spent, FREE_AI_TURNS, NOW);
    expect(view.can_start).toEqual({ card_14d: false });
    expect(view.paywall.reason).toBe('subscription_required');
  });


  it('computes the trial end from the configured length', () => {
    expect(trialEndsAt(NOW).toISOString()).toBe(inDays(CARD_TRIAL_DAYS).toISOString());
  });
});

describe('paying and lapsing', () => {
  it('active entitles regardless of the free quota', () => {
    const view = computeEntitlement(facts({ plan: 'creator', status: 'active', source: 'stripe' }), 999, NOW);
    expect(view.is_entitled).toBe(true);
    expect(view.can_use_ai).toBe(true);
    expect(view.paywall.show).toBe(false);
  });

  it('past_due keeps access until the period already paid for runs out', () => {
    // The declined payment was for the NEXT period. Cutting someone off the
    // instant a renewal fails punishes them for a bank's decision and turns a
    // dunning email into a support ticket.
    const stillPaid = facts({
      plan: 'creator',
      status: 'past_due',
      source: 'stripe',
      current_period_end: inDays(4),
      card_trial_started_at: inDays(-30),
      first_paid_at: inDays(-16),
    });
    expect(computeEntitlement(stillPaid, 999, NOW).is_entitled).toBe(true);

    const elapsed = { ...stillPaid, current_period_end: inDays(-1) };
    const view = computeEntitlement(elapsed, 999, NOW);
    expect(view.is_entitled).toBe(false);
    expect(view.paywall.reason).toBe('subscription_lapsed');
  });

  it('a card trial that never converted says subscribe, not lapsed', () => {
    const view = computeEntitlement(
      facts({ status: 'expired', card_trial_started_at: inDays(-20), first_paid_at: null }),
      FREE_AI_TURNS,
      NOW,
    );
    expect(view.paywall.reason).toBe('subscription_required');
  });

  it('a cancelled subscription that was paid for says lapsed', () => {
    const view = computeEntitlement(
      facts({ status: 'canceled', source: 'stripe', card_trial_started_at: inDays(-60), first_paid_at: inDays(-45) }),
      FREE_AI_TURNS,
      NOW,
    );
    expect(view.paywall.reason).toBe('subscription_lapsed');
  });

  it('surfaces cancel_at_period_end so the client can offer to resume', () => {
    const view = computeEntitlement(
      facts({ plan: 'creator', status: 'active', source: 'stripe', cancel_at_period_end: true }),
      0,
      NOW,
    );
    expect(view.cancel_at_period_end).toBe(true);
    expect(view.is_entitled).toBe(true);
  });
});

describe('guards against states that would grant access forever', () => {
  it('trialing with no end date does not entitle', () => {
    // The database refuses this row via subscriptions_trialing_needs_end_check,
    // but the projection must not depend on that being the only writer.
    const view = computeEntitlement(facts({ status: 'trialing', trial_ends_at: null }), 3, NOW);
    expect(view.is_entitled).toBe(false);
    expect(MIGRATION).toMatch(/subscriptions_trialing_needs_end_check/);
  });

  it('an unparseable date does not entitle', () => {
    const view = computeEntitlement(
      facts({ status: 'trialing', trial_ends_at: new Date('not a date') }),
      3,
      NOW,
    );
    expect(view.is_entitled).toBe(false);
    expect(view.trial_days_remaining).toBeNull();
  });

  it('never reports a trial end for a status that is not trialing', () => {
    const view = computeEntitlement(
      facts({ status: 'active', trial_ends_at: inDays(5) }),
      0,
      NOW,
    );
    expect(view.trial_ends_at).toBeNull();
    expect(view.trial_days_remaining).toBeNull();
  });
});

describe('the new tables are covered by account deletion', () => {
  it('every user-scoped billing table is deleted with the account', () => {
    // A deleted account that leaves a subscriptions row behind is a user who
    // keeps being billed for an account that no longer exists. The FK cascades
    // would cover it, but this file enumerates ~62 statements explicitly and a
    // table absent from that list is a table nobody checked.
    const account = fs.readFileSync(path.join(ROOT, 'server/lib/account.ts'), 'utf8');
    for (const table of ['subscriptions', 'ai_usage', 'onboarding_responses']) {
      expect(account, `${table} is not deleted with the account`).toContain(
        `DELETE FROM ${table}`,
      );
    }
  });

  it('billing_events deliberately survives, and has no user FK', () => {
    // A dispute or refund notification can arrive after the account is gone,
    // and the evidence has to outlive it. Same reasoning the deletion receipt
    // already uses.
    const account = fs.readFileSync(path.join(ROOT, 'server/lib/account.ts'), 'utf8');
    expect(account).not.toContain('DELETE FROM billing_events');
    expect(MIGRATION).not.toMatch(/billing_events[\s\S]{0,600}REFERENCES users/);
  });
});
