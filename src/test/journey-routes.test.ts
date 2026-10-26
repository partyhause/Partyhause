/**
 * The journey's routing contract, pinned.
 *
 * WHAT THIS SUITE DEFENDS
 *   The server names steps (ONBOARDING_STEPS in server/lib/onboarding-flow.ts);
 *   the web names routes. journeyRoutes.ts is the only file that knows both,
 *   and a server gaining a step, renaming one, or the route map losing an
 *   entry would strand a user on a redirect that goes nowhere — the shell
 *   would loop them to /onboarding, which would resolve to nothing. These
 *   tests make each of those failures loud, at the shape's real boundaries:
 *   completeness (every server step has a route), exclusivity (no route
 *   answers for two steps), and naming (every URL says what the screen
 *   does — the reason the routes are not /onboarding/1..5).
 *
 * The state-machine math itself (which step comes next, what completes it)
 * is server-side and already pinned by src/test/onboarding-funnel.test.ts.
 * This suite is the client's side of that contract only.
 */

import { describe, expect, it } from 'vitest';
import {
  FUNNEL_STEPS,
  INTERSTITIALS_BEFORE_STEP,
  JOURNEY_SEQUENCE,
  ONBOARDING_ROUTE,
  STEP_CLOSING_SCREENS,
  STEP_ENTRY_SCREENS,
  STEP_LABELS,
  STEP_ROUTES,
  routeForCurrentStep,
} from '@/features/onboarding/journeyRoutes';

/** The server's own step list, transcribed so a server rename fails here. */
const SERVER_STEPS = ['chat', 'who_you_are', 'ai_lifecycle', 'paywall', 'autonomy'] as const;

describe('journeyRoutes: every server step has exactly one web route', () => {
  it('covers every step id the server can send', () => {
    for (const step of SERVER_STEPS) {
      expect(STEP_ROUTES, `no route for server step '${step}'`).toHaveProperty(step);
      expect(typeof STEP_ROUTES[step]).toBe('string');
    }
  });

  it('maps no two steps to the same route', () => {
    const routes = Object.values(STEP_ROUTES);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('answers null for an unknown step rather than guessing', () => {
    // A future server step this client has not shipped yet must not be
    // routed by string-matching; the entry route fails open instead.
    expect(routeForCurrentStep(null)).toBeNull();
    expect(
      routeForCurrentStep('invite_flow' as (typeof SERVER_STEPS)[number]),
    ).toBeNull();
  });

  it('resolves each real step to its own route', () => {
    for (const step of SERVER_STEPS) {
      expect(routeForCurrentStep(step)).toBe(STEP_ROUTES[step]);
    }
  });
});

describe('journeyRoutes: the routes are named for what the screen does', () => {
  it('names every route by its function, never by a step number', () => {
    for (const route of Object.values(STEP_ROUTES)) {
      expect(route, `${route} must live under /onboarding`).toMatch(/^\/onboarding\//);
      // Step-number URLs survive redesigns badly and say nothing on support
      // calls; the naming rule is the point of this map.
      expect(route, `${route} must not be a numbered step`).not.toMatch(/\/\d+$/);
    }
  });

  it('labels every step the progress rail can render', () => {
    for (const step of SERVER_STEPS) {
      const label = STEP_LABELS[step];
      expect(label, `no label for '${step}'`).toBeTruthy();
      expect((label as string).length).toBeGreaterThan(0);
    }
  });

  it('keeps the journey order the server owns', () => {
    expect(FUNNEL_STEPS).toEqual([...SERVER_STEPS]);
  });

  it('keeps /onboarding itself outside the step routes', () => {
    // The entry resolves; the steps render. If /onboarding ever became a
    // step route too, the shell's guard would redirect to itself.
    expect(Object.values(STEP_ROUTES)).not.toContain(ONBOARDING_ROUTE.home);
  });
});

describe('journeyRoutes: the resume tables the entry resolver walks', () => {
  it('gives every server step an entry screen', () => {
    for (const step of SERVER_STEPS) {
      expect(STEP_ENTRY_SCREENS, `no entry screen for '${step}'`).toHaveProperty(step);
    }
  });

  it('enters a step at its first interstitial, else at its own screen', () => {
    for (const step of SERVER_STEPS) {
      const interstitials = INTERSTITIALS_BEFORE_STEP[step];
      const expected = interstitials.length > 0 ? interstitials[0] : STEP_ROUTES[step];
      expect(
        STEP_ENTRY_SCREENS[step],
        `a caller owed '${step}' must re-enter at '${expected}', the first screen of its segment`,
      ).toBe(expected);
    }
  });

  it('places every interstitial immediately before the step it introduces, in journey order', () => {
    for (const step of SERVER_STEPS) {
      const interstitials = INTERSTITIALS_BEFORE_STEP[step];
      if (interstitials.length === 0) continue;
      // The step's segment is [interstitials..., closing screen]: the
      // closer collects the answers, the interstitials introduce them.
      const segment = [...interstitials, STEP_CLOSING_SCREENS[step]];
      const positions = segment.map((route) => JOURNEY_SEQUENCE.indexOf(route));
      for (let i = 1; i < positions.length; i++) {
        expect(
          positions[i],
          `'${segment[i]}' must follow '${segment[i - 1]}' in JOURNEY_SEQUENCE`,
        ).toBe(positions[i - 1] + 1);
      }
    }
  });

  it('keeps the walk-back honest: who_you_are re-enters at role, not scale', () => {
    // The load-bearing case, pinned by name: the server completes
    // who_you_are from organizer_type alone, so a user who answered the
    // role screen and stopped before scale must be sent back to role —
    // the first of the segment — never straight to organizer-profile.
    expect(STEP_ENTRY_SCREENS.who_you_are).toBe(ONBOARDING_ROUTE.role);
  });
});
