/**
 * The five-screen onboarding funnel, as a server-computed state machine.
 *
 * WHY THE SERVER DECIDES WHICH SCREEN
 *   Same rule the username picker already follows: one boolean, computed once,
 *   sent to both clients (server/routes/users.ts:312-315). Two clients
 *   deriving "which step is next" from six stored answers is two chances to
 *   derive it differently, and here the divergence would put one platform's
 *   users through a paywall the other platform skips.
 *
 * THE SHAPE OF THE FUNNEL
 *   1  chat           Three model turns. The taste, and the only free value.
 *   2  who_you_are    Cheap. Builds commitment and segments the user.
 *   3  ai_lifecycle   How they want the model used before, during and after.
 *   4  paywall        HARD. Card plus a 14-day trial.
 *   5  autonomy       How much the model may do unasked.
 *
 * WHY THE WALL IS AT FOUR AND NOT THREE
 *   Screen 3 is the last cheap commitment before money, and it is the screen
 *   whose answers make the paywall specific: a wall that says "you told us you
 *   want RSVP chasing and recap drafting, that is what Pro does" converts on a
 *   different axis than one listing features.
 *
 *   It also keeps the research worth having. Everything before the wall is
 *   answered by people who never pay, and those are the only rows that can
 *   explain a refusal. `autonomy_level` sits after the wall deliberately:
 *   asked of someone who has just paid it is product setup, not a survey.
 *
 * PARTIAL IS THE NORMAL CASE
 *   Every answer column is nullable and `completed_at` stays null until the
 *   last screen. A half-finished response is kept rather than discarded,
 *   because the people who stop answering are the most interesting sample
 *   there is.
 */

import type { EntitlementView } from './entitlement';

/**
 * Which question set a stored row answers.
 *
 * Bumped whenever the questions change, so a later revision cannot silently
 * reinterpret old rows as answers to questions nobody was asked.
 */
export const ONBOARDING_SCHEMA_VERSION = '2026-09-13';

export type OnboardingStepId =
  | 'chat'
  | 'who_you_are'
  | 'ai_lifecycle'
  | 'paywall'
  | 'autonomy';

/** Screen order. The array IS the order; nothing else encodes it. */
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
  'chat',
  'who_you_are',
  'ai_lifecycle',
  'paywall',
  'autonomy',
] as const;

/** The answers a flow decision reads. All nullable; all may be absent. */
export interface OnboardingAnswerFacts {
  organizer_type: string | null;
  events_per_year: string | null;
  typical_guest_count: string | null;
  ai_before: string[];
  ai_during: string[];
  ai_after: string[];
  autonomy_level: string | null;
  agentic_wants: string[];
  biggest_pain: string | null;
  completed_at: Date | null;
}

/** A user who has answered nothing. The state every account starts in. */
export const NO_ANSWERS: OnboardingAnswerFacts = {
  organizer_type: null,
  events_per_year: null,
  typical_guest_count: null,
  ai_before: [],
  ai_during: [],
  ai_after: [],
  autonomy_level: null,
  agentic_wants: [],
  biggest_pain: null,
  completed_at: null,
};

export interface OnboardingStepView {
  id: OnboardingStepId;
  /** One-based, for display. */
  position: number;
  complete: boolean;
  /**
   * True when the user cannot reach this step yet. Only the paywall and what
   * follows it can be blocked, and only by entitlement.
   */
  locked: boolean;
}

export interface OnboardingFlowView {
  schema_version: string;
  steps: OnboardingStepView[];
  /** The step a client should render. Null once the flow is finished. */
  current_step: OnboardingStepId | null;
  /** True when every step is done. */
  completed: boolean;
  /**
   * True when the flow cannot advance without payment. The single boolean a
   * client gates the wall on.
   */
  blocked_by_paywall: boolean;
}

/**
 * Decide where a user is in the funnel.
 *
 * Step completion is derived from stored facts rather than from a stored step
 * pointer. A pointer can disagree with the data behind it; a derivation
 * cannot, and it means a user who answers a question out of band is credited
 * for it rather than asked again.
 *
 * @param answers Stored answers, or {@link NO_ANSWERS} when the row is absent.
 * @param entitlement The computed entitlement view.
 * @returns The full flow state. Never throws.
 *
 * Complexity: O(1). No I/O.
 */
export function computeOnboardingFlow(
  answers: OnboardingAnswerFacts,
  entitlement: EntitlementView,
): OnboardingFlowView {
  const done: Record<OnboardingStepId, boolean> = {
    // Tried the product at all. Any billable turn counts, and an entitled user
    // has by definition moved past the taste.
    chat: entitlement.ai.used > 0 || entitlement.is_entitled,
    who_you_are: answers.organizer_type !== null,
    ai_lifecycle:
      answers.ai_before.length > 0 ||
      answers.ai_during.length > 0 ||
      answers.ai_after.length > 0,
    // The wall is cleared by being entitled, never by dismissing it.
    paywall: entitlement.is_entitled,
    autonomy: answers.autonomy_level !== null,
  };

  const paywallIndex = ONBOARDING_STEPS.indexOf('paywall');

  const steps: OnboardingStepView[] = ONBOARDING_STEPS.map((id, index) => ({
    id,
    position: index + 1,
    complete: done[id],
    // Everything from the wall onward is locked until entitlement exists.
    // The wall itself is not locked: it is the screen that resolves the lock.
    locked: index > paywallIndex && !entitlement.is_entitled,
  }));

  const nextIncomplete = steps.find((step) => !step.complete) ?? null;

  return {
    schema_version: ONBOARDING_SCHEMA_VERSION,
    steps,
    current_step: nextIncomplete ? nextIncomplete.id : null,
    completed: nextIncomplete === null,
    // Blocked only when the wall is genuinely the thing in the way. A user who
    // has not reached it yet is not blocked by it, and saying so would make
    // every new account look paywalled from their first request.
    blocked_by_paywall: nextIncomplete?.id === 'paywall',
  };
}
