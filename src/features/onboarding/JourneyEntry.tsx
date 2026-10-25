/**
 * `/onboarding` — the resolver, not a screen.
 *
 * The server names the server-side step this account is owed
 * (flow.current_step, derived from stored answers + entitlement); this route
 * turns that into the union funnel's URL, including the screens that sit
 * between server steps.
 *
 * THE RESUME RULE, IN ONE SENTENCE
 *   Send the caller to the screen BEFORE the first incomplete server step,
 *   walking back through the interstitial screens (interests, permissions,
 *   profile) that belong to it, so a half-finished account re-enters the
 *   funnel where it left off rather than at the wall.
 *
 * WHY THE WALK-BACK
 *   The server completes `who_you_are` from organizer_type alone. A user who
 *   answered the role screen but stopped before scale owes `who_you_are`
 *   still, and the screen that opens that step on the union funnel is
 *   /onboarding/role — the first of its segment — not the scale half.
 *   Completing a step must never skip the screens that introduce it.
 *
 * FAILING OPEN GOES TO THE DASHBOARD
 *   An unreadable funnel is not a reason to strand somebody on a redirect
 *   loop. The dashboard card is hidden in that state, and the journey is
 *   offered again once the read succeeds.
 */

import { Navigate } from 'react-router-dom';
import { Loading } from '@/components/ui/loading';
import { useFunnelState } from '@/features/onboarding/useOnboardingJourney';
import { ONBOARDING_ROUTE, STEP_ENTRY_SCREENS } from '@/features/onboarding/journeyRoutes';

export function JourneyEntry() {
  const { state, isLoading } = useFunnelState();

  if (isLoading) {
    return <Loading fullScreen size="lg" />;
  }

  if (state?.flow.completed) {
    return <Navigate to="/dashboard" replace />;
  }

  // A funnel with no answers at all starts with the marketing intro, the
  // way the mobile journey does. The test is "nothing has been answered",
  // not `current_step === 'chat'`: the chat step completes from usage, so
  // an unentitled user who has already talked to the planner has answered
  // something even though their current step is still chat, and dropping
  // them back on the banner every visit would be the nag this resolver
  // exists to route around.
  const answeredNothing =
    state !== null &&
    state.answers.organizer_type === null &&
    state.answers.ai_before.length === 0 &&
    state.answers.ai_during.length === 0 &&
    state.answers.ai_after.length === 0 &&
    state.answers.agentic_wants.length === 0 &&
    state.answers.biggest_pain === null &&
    state.answers.autonomy_level === null;
  if (answeredNothing) {
    return <Navigate to="/onboarding/welcome" replace />;
  }

  if (state) {
    const intro = STEP_ENTRY_SCREENS[state.flow.current_step];
    if (intro !== undefined) {
      return <Navigate to={intro} replace />;
    }
    // Every server step complete but completed_at unset: the account owes
    // only the closing pair. profile gates payment (identity before
    // billing), so the pair is entered at profile.
    return <Navigate to={ONBOARDING_ROUTE.profile} replace />;
  }

  // Fail open: no state at all means the funnel could not be read. The
  // dashboard decides what to offer; stranding the user here on a spinner
  // or bouncing them into a wall they cannot see serves nobody.
  return <Navigate to="/dashboard" replace />;
}
