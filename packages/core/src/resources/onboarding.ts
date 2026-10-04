/**
 * The five-screen funnel, for both clients.
 *
 * WHICH SCREEN COMES NEXT IS A SERVER DECISION
 *   `flow.current_step` is derived server-side from the answers that exist and
 *   the caller's entitlement. Clients render it. The same rule the username
 *   picker already follows for `show_picker`, and for the same reason: two
 *   clients deriving "which step is next" from six stored answers is two
 *   chances to derive it differently, and the divergence would put one
 *   platform's users through a paywall the other skips.
 *
 * ANSWERS ARE SAVED PER SCREEN, NOT AT THE END
 *   A user who leaves mid-flow has still told us something, and the people who
 *   stop answering are the most interesting sample there is. Every field is
 *   optional and `completed_at` stays null until the last screen is submitted.
 */

import type { Transport, ApiResponse } from '../http/transport';
import type { EntitlementView, OnboardingAnswers, OnboardingResponse } from '../types';

/** One step of the funnel, as the server reports it. */
export interface OnboardingStepView {
  id: 'chat' | 'who_you_are' | 'ai_lifecycle' | 'paywall' | 'autonomy';
  /** One-based, for display. */
  position: number;
  complete: boolean;
  /** True when the step cannot be reached yet. Only the wall and what follows. */
  locked: boolean;
}

export interface OnboardingFlowView {
  schema_version: string;
  steps: OnboardingStepView[];
  /** The step to render. Null once the funnel is finished. */
  current_step: OnboardingStepView['id'] | null;
  completed: boolean;
  /** The single boolean a client gates the wall on. */
  blocked_by_paywall: boolean;
}

/**
 * Everything a client needs to render the funnel, in one call.
 *
 * Named `OnboardingFunnelState`, not `OnboardingState`, because that name is
 * already taken by the username picker's state in
 * `packages/core/src/contracts/user.ts`. Two different meanings under one name
 * is the SSOT defect this package exists to remove, and the compiler caught it
 * the moment both were exported from the same barrel.
 */
export interface OnboardingFunnelState {
  flow: OnboardingFlowView;
  answers: OnboardingResponse;
  entitlement: EntitlementView;
}

export interface OnboardingResource {
  /**
   * Where the caller is in the funnel, what they have answered, and what they
   * are entitled to.
   *
   * One call rather than three, because a client assembling this from three
   * endpoints would have three chances to assemble it differently from the
   * other client.
   */
  get(): Promise<ApiResponse<OnboardingFunnelState>>;

  /**
   * Save whatever has been answered so far.
   *
   * Only keys actually present are written, so saving screen three cannot
   * blank screen two. An explicitly empty array IS a meaningful answer, "none
   * of these", which is why absence rather than emptiness is the test.
   *
   * `completed: true` is one-way. Re-submitting the final screen does not move
   * the timestamp, so a user revisiting the flow cannot drift their own cohort
   * date forward.
   *
   * @returns The recomputed flow, so the client re-renders from the server's
   *          answer rather than from an optimistic local guess.
   */
  save(answers: OnboardingAnswers): Promise<ApiResponse<OnboardingFunnelState>>;
}

export function createOnboardingResource(t: Transport): OnboardingResource {
  return {
    get: () => t.request<OnboardingFunnelState>('/api/onboarding', { method: 'GET' }),
    save: (answers) =>
      t.request<OnboardingFunnelState>('/api/onboarding', { method: 'PATCH', body: answers }),
  };
}
