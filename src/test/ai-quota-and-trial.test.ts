/**
 * The two blockers that made the paid tier unsellable, pinned.
 *
 * B1: nothing could write `subscriptions.status`, so the onboarding funnel's
 *     paywall step could never be cleared. Every user who answered every
 *     question was stuck on screen four permanently while the API told them a
 *     trial was available.
 *
 * B2: the quota read the count, awaited the model, then recorded usage. Two
 *     concurrent requests both read the pre-write total and both passed. The
 *     window was the whole model call, so two browser tabs was enough.
 *
 * WHY THE CONCURRENCY CASE NEEDS A REAL DATABASE
 *   The first fix for B2 was `INSERT ... SELECT ... WHERE (SELECT count(*)) < N`,
 *   which reads as atomic and is not: PostgreSQL defaults to READ COMMITTED,
 *   so ten simultaneous statements each saw a count of zero and each inserted.
 *   No unit test with a mocked client would have caught that, because the
 *   defect is in the isolation level rather than the logic. Those cases are in
 *   the Postgres integration suite and are skipped without DATABASE_URL.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CARD_TRIAL_DAYS,
  FREE_AI_TURNS,
  NO_SUBSCRIPTION,
  computeEntitlement,
} from '../../server/lib/entitlement';
import {
  NO_ANSWERS,
  computeOnboardingFlow,
  type OnboardingAnswerFacts,
} from '../../server/lib/onboarding-flow';
import { startCardTrial } from '../../server/lib/trial';
import { claimAiTurn, settleAiTurn } from '../../server/lib/ai-quota';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** Everything answered, quota spent. The state B1 stranded people in. */
const ANSWERED: OnboardingAnswerFacts = {
  ...NO_ANSWERS,
  organizer_type: 'personal',
  ai_before: ['budget'],
  autonomy_level: 'draft',
};

describe('B1: the funnel has an exit', () => {
  it('is stuck at the wall before a trial exists', () => {
    const flow = computeOnboardingFlow(
      ANSWERED,
      computeEntitlement(NO_SUBSCRIPTION, FREE_AI_TURNS, NOW),
    );
    expect(flow.current_step).toBe('paywall');
    expect(flow.completed).toBe(false);
  });

  it('completes once a trial is running', () => {
    const trialing = computeEntitlement(
      {
        ...NO_SUBSCRIPTION,
        plan: 'pro',
        status: 'trialing',
        card_trial_started_at: NOW,
        trial_ends_at: new Date(NOW.getTime() + CARD_TRIAL_DAYS * DAY),
      },
      FREE_AI_TURNS,
      NOW,
    );
    const flow = computeOnboardingFlow(ANSWERED, trialing);
    expect(flow.current_step).toBeNull();
    expect(flow.completed).toBe(true);
    expect(flow.blocked_by_paywall).toBe(false);
  });

  it('refuses a second trial, whether or not the first converted', async () => {
    // Eligibility is "never started", not "not currently running". Checking
    // the latter lets a user cycle the same free fortnight forever, which
    // loses the paid tier outright.
    const spent = {
      status: 'expired',
      card_trial_started_at: new Date(NOW.getTime() - 40 * DAY),
      trial_ends_at: new Date(NOW.getTime() - 26 * DAY),
    };
    const database = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: vi.fn().mockResolvedValue([spent]) }),
      ),
    };

    const result = await startCardTrial(database as never, 'u1', NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TRIAL_ALREADY_USED');
  });

  it('answers a double tap from the row rather than erroring', async () => {
    // The user asked for a trial and they have one. A second tap is not a
    // fault and must not read like one.
    const running = {
      status: 'trialing',
      card_trial_started_at: NOW,
      trial_ends_at: new Date(NOW.getTime() + 5 * DAY),
    };
    const database = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: vi.fn().mockResolvedValue([running]) }),
      ),
    };

    const result = await startCardTrial(database as never, 'u1', NOW);
    expect(result.ok).toBe(true);
    expect(result.alreadyRunning).toBe(true);
  });

  it('refuses to hand a trial to an active subscriber', async () => {
    const database = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: vi.fn().mockResolvedValue([{ status: 'active', card_trial_started_at: null, trial_ends_at: null }]) }),
      ),
    };
    const result = await startCardTrial(database as never, 'u1', NOW);
    expect(result.code).toBe('ALREADY_SUBSCRIBED');
  });

  it('takes a row lock, so two requests cannot both start one', async () => {
    // Without FOR UPDATE both read "never trialed" and both write, spending
    // one trial twice and leaving the loser an end date it did not choose.
    const queryRaw = vi.fn().mockResolvedValue([]);
    const database = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: queryRaw, subscription: { upsert: vi.fn() } }),
      ),
    };
    await startCardTrial(database as never, 'u1', NOW);
    const sql = queryRaw.mock.calls[0][0].join?.('?') ?? String(queryRaw.mock.calls[0][0]);
    expect(sql).toMatch(/FOR UPDATE/);
  });
});

describe('B2: the quota is claimed before the model runs', () => {
  it('reserves nothing for an entitled caller', async () => {
    // A subscriber has no quota to consume. Recording one would make `used`
    // climb forever and misreport every entitled account as over its limit
    // the moment a trial ends.
    const database = { $transaction: vi.fn() };
    const claim = await claimAiTurn(database as never, 'u1', true);

    expect(claim.granted).toBe(true);
    expect(claim.reservationId).toBeNull();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('serialises per user with a transaction-scoped advisory lock', async () => {
    // The lock is what makes the count-then-insert safe. Transaction-scoped,
    // so it releases on commit or rollback without an unlock call a crash
    // could skip.
    const executeRaw = vi.fn();
    const database = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          $executeRaw: executeRaw,
          aiUsage: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'r1' }) },
        }),
      ),
    };

    await claimAiTurn(database as never, 'u1', false);
    const sql = executeRaw.mock.calls[0][0].join?.('?') ?? String(executeRaw.mock.calls[0][0]);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
  });

  it('refuses once the quota is spent', async () => {
    const database = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          $executeRaw: vi.fn(),
          aiUsage: { count: vi.fn().mockResolvedValue(FREE_AI_TURNS), create: vi.fn() },
        }),
      ),
    };
    const claim = await claimAiTurn(database as never, 'u1', false);
    expect(claim.granted).toBe(false);
    expect(claim.reservationId).toBeNull();
  });

  it('releases the seat when the turn failed', async () => {
    // Charging for an answer the user never received is the one outcome with
    // no defence.
    const del = vi.fn();
    await settleAiTurn(
      { aiUsage: { delete: del, update: vi.fn() } } as never,
      { granted: true, reservationId: 'r1', used: 1 },
      'failed',
    );
    expect(del).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });

  it('corrects a heuristic reply rather than deleting it', async () => {
    // It must not spend a turn, because it costs nothing to serve. It is kept
    // because the heuristic-to-llm ratio is the only signal that the model is
    // unconfigured or timing out, and deleting the row destroys it.
    const update = vi.fn();
    const del = vi.fn();
    await settleAiTurn(
      { aiUsage: { delete: del, update } } as never,
      { granted: true, reservationId: 'r1', used: 1 },
      'heuristic',
    );
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { source: 'heuristic' } });
    expect(del).not.toHaveBeenCalled();
  });

  it('leaves an llm reply as reserved', async () => {
    const update = vi.fn();
    const del = vi.fn();
    await settleAiTurn(
      { aiUsage: { delete: del, update } } as never,
      { granted: true, reservationId: 'r1', used: 1 },
      'llm',
    );
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

describe('the route wires it in the only safe order', () => {
  const source = () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.resolve(__dirname, '../../server/routes/ai.ts'), 'utf8');
  };

  it('claims the seat before calling the model', () => {
    // Reserving first is the only ordering that cannot overspend. Charging
    // afterwards leaves the whole model call open as a race, which is exactly
    // where the defect lived.
    const text = source();
    expect(text.indexOf('claimAiTurn')).toBeLessThan(text.indexOf('runChatTurn(messages)'));
  });

  it('settles after, and releases on throw', () => {
    const text = source();
    expect(text).toMatch(/settleAiTurn\(prisma, claim, 'failed'\)/);
    expect(text).toMatch(/settleAiTurn\(prisma, claim, result\.source\)/);
  });

  it('answers 402 rather than 403', () => {
    expect(source()).toMatch(/status\(402\)/);
    expect(source()).toMatch(/PAYMENT_REQUIRED/);
  });
});

describe('B3: the wall reaches the clients', () => {
  const read = (relative: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
  };

  it.each([
    ['web', 'src/components/templates/AIEventAssistant.tsx'],
    ['mobile', 'apps/mobile/app/events/create/assistant.tsx'],
  ])('%s treats 402 as the wall, not as a failure', (_platform, file) => {
    // Both clients previously special-cased only 429 and fell through to a
    // generic message. A walled user was told "the planner could not be
    // reached", which is untrue and unactionable: nothing is broken, they have
    // used their three turns.
    const source = read(file);
    expect(source).toMatch(/status === 402/);
    // The reason is carried, not flattened to a boolean. The server sends one
    // precisely so the copy can differ: somebody who has never trialed needs a
    // different sentence from somebody whose trial lapsed last week.
    expect(source).toMatch(/setQuotaSpent\(\s*\(/);
    expect(source).toMatch(/paywall\?\.reason \?\? null/);
  });

  it.each([
    ['web', 'src/components/templates/AIEventAssistant.tsx'],
    ['mobile', 'apps/mobile/app/events/create/assistant.tsx'],
  ])('%s actually RENDERS the wall it sets', (_platform, file) => {
    // The first cut of this set `quotaSpent` and read it nowhere, so a walled
    // user watched the spinner stop and saw nothing at all. That is strictly
    // worse than the generic error it replaced: at least the error was
    // visible. A state flag with no reader is not a feature.
    const source = read(file);
    expect(source).toMatch(/quotaSpent !== false/);
    expect(source).toMatch(/paywallCopy\(quotaSpent\)\.title/);
    expect(source).toMatch(/paywallCopy\(quotaSpent\)\.cta/);
  });

  it.each([
    ['web', 'src/components/templates/AIEventAssistant.tsx'],
    ['mobile', 'apps/mobile/app/events/create/assistant.tsx'],
  ])('%s gives the wall an exit that is not paying', (_platform, file) => {
    // The planner accelerates a form that still works unaided. A wall with no
    // way past it converts a user who was not going to pay today into a user
    // who leaves.
    expect(read(file)).toMatch(/paywallCopy\(quotaSpent\)\.dismiss/);
  });

  it.each([
    ['web', 'src/components/templates/AIEventAssistant.tsx'],
    ['mobile', 'apps/mobile/app/events/create/assistant.tsx'],
  ])('%s does not route 402 into the error state', (_platform, file) => {
    // The wall is a next step, not a fault, and rendering it as red text is
    // the difference between "you have used your trial" and "we are broken".
    const source = read(file);
    const at = source.indexOf('status === 402');
    expect(source.slice(at, at + 220)).toMatch(/setError\(null\)/);
  });
});

describe('B4: both clients can reach billing and onboarding', () => {
  it('the shared client exposes them', async () => {
    const { createApiClient, createMemoryStorage } = await import('../../packages/core/src/index');
    const api = createApiClient({ baseUrl: 'https://x.test', storage: createMemoryStorage() });

    // /api/billing and /api/onboarding were mounted and complete with zero
    // callers on either platform. packages/core had no way to reach them, so
    // iOS could not evaluate the paywall at all.
    expect(typeof api.billing.entitlement).toBe('function');
    expect(typeof api.billing.startTrial).toBe('function');
    expect(typeof api.onboarding.get).toBe('function');
    expect(typeof api.onboarding.save).toBe('function');
  });

  it('does not collide with the username picker state', async () => {
    // Both are called "onboarding" and they are different things: one is the
    // username picker, one is the five-screen funnel. The funnel type is
    // OnboardingFunnelState for that reason, and the compiler caught the
    // collision the moment both were exported from one barrel.
    const core = await import('../../packages/core/src/index');
    expect(Object.keys(core)).not.toContain('OnboardingState');
  });
});

describe('the trial length is declared once', () => {
  it('the contract owns it and the server re-exports it', async () => {
    // It was declared in server/lib/entitlement.ts, where no client can read
    // it, and both clients must render the number before they have called
    // anything. A client promising 14 days against a server granting 7 is a
    // chargeback, not a display bug.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../..');
    const server = fs.readFileSync(path.join(root, 'server/lib/entitlement.ts'), 'utf8');

    const { CARD_TRIAL_DAYS } = await import('../../packages/core/src/contracts/billing');
    expect(CARD_TRIAL_DAYS).toBe(14);
    expect(server).not.toMatch(/const CARD_TRIAL_DAYS\s*=/);
    expect(server).toMatch(/import \{ CARD_TRIAL_DAYS \} from '@partyhause\/core\/contracts\/billing'/);
  });

  it('the wall quotes that number rather than a literal', async () => {
    const { paywallCopy } = await import('../../packages/core/src/paywall-copy');
    const { CARD_TRIAL_DAYS } = await import('../../packages/core/src/contracts/billing');
    expect(paywallCopy('free_quota_exhausted').cta).toContain(String(CARD_TRIAL_DAYS));
  });

  it('every paywall reason has copy, including an unknown one', async () => {
    // A wall that renders no words is the one outcome with no recovery: the
    // user sees a dead button and cannot tell what happened.
    const { paywallCopy } = await import('../../packages/core/src/paywall-copy');
    for (const reason of ['free_quota_exhausted', 'subscription_required', 'subscription_lapsed', null] as const) {
      const copy = paywallCopy(reason);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.cta.length).toBeGreaterThan(0);
      expect(copy.dismiss.length).toBeGreaterThan(0);
    }
  });
});
