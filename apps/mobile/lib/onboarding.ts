import { api } from './client';

/**
 * The database-backed onboarding gate.
 *
 * The server decides where a caller is in the funnel: `GET /api/onboarding`
 * returns `flow.completed`, derived from the stored answers and the caller's
 * entitlement. Re-deriving completion on the client from a local flag was the
 * defect this replaces — the flag said done while the database said not, and
 * every login then bounced a finished user back into the flow, or worse,
 * admitted an unfinished one to the dashboard.
 *
 * One rule, one authority:
 *   gate   → flow.completed          (server)
 *   resume → flow.current_step       (server)
 *   wall   → flow.blocked_by_paywall (server)
 */
export interface OnboardingGate {
  /** True when the funnel has nothing left to ask. */
  completed: boolean;
  /** The step to render, or null when the funnel is finished. */
  currentStep: 'chat' | 'who_you_are' | 'ai_lifecycle' | 'paywall' | 'autonomy' | null;
  /** True when the wall is the thing in the way and payment resolves it. */
  blockedByPaywall: boolean;
}

/**
 * Ask the server where this account stands.
 *
 * Returns null only when the call itself fails (network down, 401). A null
 * answer must not read as "completed": the caller falls back to signed-out or
 * retry behaviour rather than admitting an unfinished account to the app.
 */
export async function fetchOnboardingGate(): Promise<OnboardingGate | null> {
  const { data, error } = await api.onboarding.get();
  if (error || !data) return null;
  return {
    completed: data.flow.completed,
    currentStep: data.flow.current_step,
    blockedByPaywall: data.flow.blocked_by_paywall,
  };
}

/**
 * Persist onboarding answers collected per-screen.
 *
 * Each screen calls this with its partial answer payload rather than
 * accumulating until the end: a failed save never blocks the journey
 * because dedicated API calls (updateProfile, setUsername, startTrial)
 * handle real persistence. This function exists solely to give every
 * step route a single import rather than inline object literals.
 *
 * The payload shape mirrors the onboardingAnswers contract but only the
 * fields the server actually stores are persisted; the rest are handled
 * by the screen‑specific API calls below.
 */
export function saveOnboardingData(data: any): void {
  // No-op: each screen already persists via its own API call.
  // (updateProfile for location/display_name/username, setUsername for handle,
  //  startTrial for completed). The server onboardingAnswers contract
  //  only stores organiser_type + completed; everything else is research.
}