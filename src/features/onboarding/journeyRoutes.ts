/**
 * The single map from the server's step ids to this app's routes, plus the
 * two journey segments that are not server steps.
 *
 * THE UNION FUNNEL
 *   The mobile app's 8 screens are now the web journey's spine. The server's
 *   five named steps (ONBOARDING_STEPS in server/lib/onboarding-flow.ts) are
 *   all still reached — each by exactly one screen — but the screens that do
 *   not map to a server step (interests, permissions, profile, payment-as-
 *   screen) sit between them in the order the mobile journey established.
 *   `current_step` stays the resume key: it is derived server-side from the
 *   stored answers, never stored, and a returning user is sent to the first
 *   incomplete SERVER step's screen. The screens between answers are re-shown
 *   only when their neighbor steps are still open, which the entry resolver
 *   computes.
 *
 * WHY THE SCREENS ARE NAMED BY WHAT THEY DO, NOT "ONBOARDING 1..N"
 *   A URL is a contract with the person using it: `/onboarding/plan` says
 *   what the screen asks for, survives a redesign, and can be deep-linked
 *   from support, email or another surface without a step-number lookup.
 *   The server's step ids stay the join key — this map is the only place
 *   that knows both vocabularies, so the two can evolve independently.
 */

import type { FunnelStepId } from '@/features/onboarding/useOnboardingJourney';

export const ONBOARDING_ROUTE = {
  /** `/onboarding` itself: resolves the server's current step and redirects. */
  home: '/onboarding',
  /**
   * The marketing intro, before the first question. Not a server step:
   * reached from the entry resolver only when the funnel has no answers.
   */
  welcome: '/onboarding/welcome',
  /** who_you_are, first half — the four organizer types ("I'm a vendor"...). */
  role: '/onboarding/role',
  /** Between answers — the event-type chips. Persisted via event_interests. */
  interests: '/onboarding/interests',
  /** who_you_are, second half — scale questions, mirroring mobile order. */
  organizerProfile: '/onboarding/organizer-profile',
  /**
   * The location pause, after who_you_are. Enrichment to the profile's
   * location field, not a server step: skippable, never blocks.
   */
  whereYouHost: '/onboarding/where',
  /** The contacts primer. Web shows it as information; there is no prompt. */
  permissions: '/onboarding/permissions',
  /** chat — try the planner. The only step that completes from usage. */
  plannerChat: '/onboarding/planner-chat',
  /** ai_lifecycle — where the assistant should help, across the event. */
  aiWorkflow: '/onboarding/ai-workflow',
  /** paywall — the 14-day card trial. */
  plan: '/onboarding/plan',
  /** autonomy — how much the assistant may do unasked. */
  assistantAutonomy: '/onboarding/assistant-autonomy',
  /**
   * profile + payment are the funnel's closing pair: identity (display
   * name, handle, marketing opt-in) then the once-per-account trial.
   */
  profile: '/onboarding/profile',
  payment: '/onboarding/payment',
} as const;

/** The step ids in journey order, per the server's ONBOARDING_STEPS. */
export const FUNNEL_STEPS: readonly FunnelStepId[] = [
  'chat',
  'who_you_are',
  'ai_lifecycle',
  'paywall',
  'autonomy',
] as const;

export const STEP_ROUTES: Record<FunnelStepId, string> = {
  chat: ONBOARDING_ROUTE.plannerChat,
  who_you_are: ONBOARDING_ROUTE.role,
  ai_lifecycle: ONBOARDING_ROUTE.aiWorkflow,
  paywall: ONBOARDING_ROUTE.plan,
  autonomy: ONBOARDING_ROUTE.assistantAutonomy,
};

/**
 * The screens that introduce each server step, keyed by step id. The entry
 * resolver walks the funnel's first incomplete SERVER step here; the value
 * is the screen that step's answers begin on, which is the step's own
 * screen for every step except who_you_are (role introduces it).
 *
 * Kept aligned with STEP_ROUTES: a step's intro screen and its
 * routeForCurrentStep route are the same value for all steps whose answers
 * begin on their own screen, so this table only lists the exceptions.
 */
export const STEP_ENTRY_SCREENS: Record<FunnelStepId, string> = {
  chat: ONBOARDING_ROUTE.plannerChat,
  who_you_are: ONBOARDING_ROUTE.role,
  ai_lifecycle: ONBOARDING_ROUTE.aiWorkflow,
  paywall: ONBOARDING_ROUTE.plan,
  autonomy: ONBOARDING_ROUTE.assistantAutonomy,
};

/**
 * Interstitial screens that belong to the step that follows them. A caller
 * owed that step re-enters at the FIRST screen listed, not the step's own
 * screen: role and interests both introduce who_you_are, so a user who
 * answered nothing about their events starts back at role and sees interests
 * again on the way through.
 *
 * The walk-back rule: the day a new interstitial screen is added to the
 * union funnel, this table changes together with STEP_ENTRY_SCREENS and
 * JOURNEY_SEQUENCE, or the resume logic starts skipping the new screen for
 * returning users. Those three tables are one contract and live in the same
 * review.
 */
export const INTERSTITIALS_BEFORE_STEP: Record<FunnelStepId, readonly string[]> = {
  chat: [],
  who_you_are: [ONBOARDING_ROUTE.role, ONBOARDING_ROUTE.interests],
  ai_lifecycle: [],
  paywall: [],
  autonomy: [],
};

/**
 * The screen that completes each server step's segment — the step's own
 * screen when its answers begin there, the LAST introducing screen when they
 * do not. who_you_are is the only split segment today: role and interests
 * introduce it, organizer-profile collects its answers, so the segment is
 * [role, interests, organizerProfile] and the closer is organizerProfile.
 *
 * Where a step's segment ENDS matters to the progress rail and to the
 * journey-order invariant; where it BEGINS is STEP_ENTRY_SCREENS. Both are
 * resume questions and both tables change with INTERSTITIALS_BEFORE_STEP.
 */
export const STEP_CLOSING_SCREENS: Record<FunnelStepId, string> = {
  chat: ONBOARDING_ROUTE.plannerChat,
  who_you_are: ONBOARDING_ROUTE.organizerProfile,
  ai_lifecycle: ONBOARDING_ROUTE.aiWorkflow,
  paywall: ONBOARDING_ROUTE.plan,
  autonomy: ONBOARDING_ROUTE.assistantAutonomy,
};

/**
 * The label each step carries on the progress rail and the dashboard card.
 * Same vocabulary the screens use in their headings, so the rail never
 * introduces a second name for the same thing.
 */
export const STEP_LABELS: Record<FunnelStepId, string> = {
  chat: 'Try the planner',
  who_you_are: 'About your events',
  ai_lifecycle: 'Where AI helps',
  paywall: 'Choose your plan',
  autonomy: 'Assistant autonomy',
};

/**
 * Every route the journey owns, in walking order. The entry resolver walks
 * this list; the progress rail counts through it. Server steps and the
 * screens between them share one sequence so "3 of 9" means something.
 */
export const JOURNEY_SEQUENCE: readonly string[] = [
  ONBOARDING_ROUTE.welcome,
  ONBOARDING_ROUTE.role,
  ONBOARDING_ROUTE.interests,
  ONBOARDING_ROUTE.organizerProfile,
  ONBOARDING_ROUTE.whereYouHost,
  ONBOARDING_ROUTE.permissions,
  ONBOARDING_ROUTE.plannerChat,
  ONBOARDING_ROUTE.aiWorkflow,
  ONBOARDING_ROUTE.plan,
  ONBOARDING_ROUTE.assistantAutonomy,
  ONBOARDING_ROUTE.profile,
  ONBOARDING_ROUTE.payment,
];

/**
 * Where `/onboarding` should send the caller.
 *
 * @returns The route for the server's current step, or null when the journey
 *          is finished or unknown. The caller decides what null means for its
 *          surface — the entry route redirects to the dashboard; the
 *          dashboard card stays hidden.
 */
export function routeForCurrentStep(currentStep: FunnelStepId | null): string | null {
  // The `in` guard is the whole body's point: an unknown id from a newer or
  // older server must degrade to null rather than produce `undefined` typed
  // as string, which callers would then hand to <Navigate>.
  return currentStep !== null && currentStep in STEP_ROUTES ? STEP_ROUTES[currentStep] : null;
}
