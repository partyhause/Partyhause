/**
 * The five-screen funnel and the quota gate.
 *
 * WHY THE STATE MACHINE IS DERIVED, NOT STORED
 *   There is no `current_step` column. The step is derived from the answers
 *   that exist, because a stored pointer can disagree with the data behind it
 *   and a derivation cannot. It also means a user who answers something out of
 *   band is credited for it rather than asked again.
 *
 * WHAT THE WALL COSTS, PINNED HERE ON PURPOSE
 *   The paywall sits at position 4, after the AI-lifecycle questions. That is
 *   a revenue decision with a research cost, and both halves are asserted:
 *   everything before the wall is answerable by people who never pay, and
 *   `autonomy_level` deliberately is not.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_ANSWERS,
  ONBOARDING_SCHEMA_VERSION,
  ONBOARDING_STEPS,
  computeOnboardingFlow,
  type OnboardingAnswerFacts,
} from '../../server/lib/onboarding-flow';
import {
  FREE_AI_TURNS,
  NO_SUBSCRIPTION,
  computeEntitlement,
} from '../../server/lib/entitlement';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function answers(over: Partial<OnboardingAnswerFacts> = {}): OnboardingAnswerFacts {
  return { ...NO_ANSWERS, ...over };
}

/** Entitlement for a user who has spent `turns` and is not paying. */
const free = (turns: number) => computeEntitlement(NO_SUBSCRIPTION, turns, NOW);

/** Entitlement for a user in a running trial. */
const trialing = computeEntitlement(
  {
    ...NO_SUBSCRIPTION,
    plan: 'pro',
    status: 'trialing',
    source: 'stripe',
    card_trial_started_at: NOW,
    trial_ends_at: new Date(NOW.getTime() + 14 * DAY),
  },
  FREE_AI_TURNS,
  NOW,
);

describe('funnel shape', () => {
  it('is five screens in a fixed order with the wall fourth', () => {
    expect(ONBOARDING_STEPS).toEqual([
      'chat',
      'who_you_are',
      'ai_lifecycle',
      'paywall',
      'autonomy',
    ]);
  });

  it('carries a schema version, so a later question set cannot reinterpret old rows', () => {
    expect(computeOnboardingFlow(NO_ANSWERS, free(0)).schema_version).toBe(
      ONBOARDING_SCHEMA_VERSION,
    );
  });
});

describe('walking the funnel', () => {
  it('starts a brand new user at the chat', () => {
    const flow = computeOnboardingFlow(NO_ANSWERS, free(0));
    expect(flow.current_step).toBe('chat');
    expect(flow.completed).toBe(false);
    // A user who has not reached the wall is not blocked by it. Saying
    // otherwise would make every new account look paywalled on first load.
    expect(flow.blocked_by_paywall).toBe(false);
  });

  it('advances past the chat once a turn has been taken', () => {
    expect(computeOnboardingFlow(NO_ANSWERS, free(1)).current_step).toBe('who_you_are');
  });

  it('advances through the two research screens without payment', () => {
    // This is the whole point of the wall being fourth: these answers come
    // from everyone, including the people who never pay, and those are the
    // only rows that can explain a refusal.
    const afterWho = computeOnboardingFlow(
      answers({ organizer_type: 'professional' }),
      free(FREE_AI_TURNS),
    );
    expect(afterWho.current_step).toBe('ai_lifecycle');
    expect(afterWho.blocked_by_paywall).toBe(false);
  });

  it('stops at the wall once the research screens are done', () => {
    const flow = computeOnboardingFlow(
      answers({ organizer_type: 'professional', ai_before: ['budget'] }),
      free(FREE_AI_TURNS),
    );
    expect(flow.current_step).toBe('paywall');
    expect(flow.blocked_by_paywall).toBe(true);
  });

  it('counts any one lifecycle answer as the screen being done', () => {
    // A user who only cares about what happens during the event has still
    // answered the question. Requiring all three would be asking them to
    // invent needs they do not have.
    for (const key of ['ai_before', 'ai_during', 'ai_after'] as const) {
      const flow = computeOnboardingFlow(
        answers({ organizer_type: 'personal', [key]: ['something'] }),
        free(FREE_AI_TURNS),
      );
      expect(flow.current_step).toBe('paywall');
    }
  });

  it('only the wall clears the wall', () => {
    // There is no dismiss. The step is complete when entitlement exists and at
    // no other time, which is what makes it hard rather than a prompt.
    const stuck = computeOnboardingFlow(
      answers({ organizer_type: 'personal', ai_during: ['check-in'], autonomy_level: 'draft' }),
      free(FREE_AI_TURNS),
    );
    expect(stuck.current_step).toBe('paywall');
    expect(stuck.completed).toBe(false);
  });

  it('opens the last screen once a trial is running', () => {
    const flow = computeOnboardingFlow(
      answers({ organizer_type: 'personal', ai_during: ['check-in'] }),
      trialing,
    );
    expect(flow.current_step).toBe('autonomy');
    expect(flow.blocked_by_paywall).toBe(false);
  });

  it('finishes when every step is done', () => {
    const flow = computeOnboardingFlow(
      answers({
        organizer_type: 'corporate',
        ai_before: ['budget'],
        autonomy_level: 'act_with_approval',
        completed_at: NOW,
      }),
      trialing,
    );
    expect(flow.completed).toBe(true);
    expect(flow.current_step).toBeNull();
  });
});

describe('locking', () => {
  it('locks everything after the wall, and never the wall itself', () => {
    // The wall is the screen that resolves the lock, so locking it would be a
    // dead end with no way forward.
    const steps = computeOnboardingFlow(NO_ANSWERS, free(0)).steps;
    const locked = steps.filter((s) => s.locked).map((s) => s.id);
    expect(locked).toEqual(['autonomy']);
  });

  it('unlocks once entitled', () => {
    expect(computeOnboardingFlow(NO_ANSWERS, trialing).steps.some((s) => s.locked)).toBe(false);
  });

  it('reports positions one-based for display', () => {
    const steps = computeOnboardingFlow(NO_ANSWERS, free(0)).steps;
    expect(steps.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
    expect(steps.find((s) => s.id === 'paywall')?.position).toBe(4);
  });
});

describe('an entitled user is never re-walled', () => {
  it('counts the chat as done for someone who paid before using it', () => {
    // Buying without trying is unusual but legal, and asking such a user to go
    // and use their free turns before continuing would be absurd.
    const flow = computeOnboardingFlow(NO_ANSWERS, trialing);
    expect(flow.steps.find((s) => s.id === 'chat')?.complete).toBe(true);
    expect(flow.current_step).toBe('who_you_are');
  });
});

describe('the AI route enforces the quota', () => {
  const source = () => {
    // Read rather than imported, because the assertions are about the shape of
    // the guard rather than about calling it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.resolve(__dirname, '../../server/routes/ai.ts'), 'utf8');
  };

  it('answers 402, not 403', () => {
    // The request is well-formed and the caller is authenticated; what is
    // missing is payment. A 403 is indistinguishable from an authorization
    // failure and the client would render the wrong screen.
    expect(source()).toMatch(/status\(402\)/);
    expect(source()).toMatch(/PAYMENT_REQUIRED/);
  });

  it('claims the seat BEFORE the turn, not after', () => {
    // This assertion previously required the opposite, and the opposite was
    // the defect. Reading the count, awaiting the model, then recording usage
    // left the entire model call open as a race: ten simultaneous claims
    // against a quota of three all saw a count of zero and all passed.
    // Reserving first is the only ordering that cannot overspend.
    //
    // The cost is a leaked reservation if the process dies mid-turn: one row,
    // recoverable, bounded. Overspending is unbounded.
    const text = source();
    expect(text.indexOf('claimAiTurn')).toBeLessThan(text.indexOf('runChatTurn(messages)'));
  });

  it('settles the reservation with the engine that actually answered', () => {
    // runChatTurn falls back to a free deterministic extractor whenever the
    // model is unconfigured or times out, and the user cannot tell. Settling
    // with result.source is what stops a heuristic reply spending a turn.
    expect(source()).toContain('settleAiTurn(prisma, claim, result.source)');
  });

  it('releases the seat when the turn throws', () => {
    // Charging for an answer the user never received is the one outcome with
    // no defence.
    expect(source()).toContain("settleAiTurn(prisma, claim, 'failed')");
  });

  it('never lets a settlement failure break a turn the user already received', () => {
    // Under-counting is a cost. A 500 after a successful answer is a support
    // ticket, and the user has already read the reply.
    const text = source();
    const at = text.indexOf('settleAiTurn(prisma, claim, result.source)');
    expect(text.slice(at - 200, at + 200)).toMatch(/try/);
  });

  it('fails open when entitlement cannot be read', () => {
    // A database blip must not lock a paying customer out of the feature they
    // are paying for. The blast radius is a handful of free turns during an
    // outage; the opposite default is an outage that looks like a billing
    // dispute.
    expect(source()).toMatch(/allowing the turn/i);
  });

});
