/**
 * `chat` — the taste screen. The only step that completes from usage rather
 * than from an answer: `chat: entitlement.ai.used > 0 || is_entitled`
 * (server/lib/onboarding-flow.ts), so the screen's job is to get one real
 * planner turn to happen, not to record anything.
 *
 * REUSES src/components/templates/AIEventAssistant.tsx WHOLE
 *   The assistant already owns the entire chat surface — turns, the 402 wall
 *   with its start-trial CTA, the extraction preview — and it is pinned by
 *   ai-planner-parity.test.ts against both platforms. A second chat UI beside
 *   it is exactly how the two HTTP clients in this repository came to
 *   disagree.
 *
 * WHAT `onComplete` MEANS HERE
 *   In EventCreation it hands extracted data to a form. Here the same event
 *   means "the user has seen what the planner does": the answers PATCH this
 *   journey owns is not called (there is nothing to save for this step), the
 *   funnel state is refreshed so the server's recomputation moves the rail,
 *   and the next screen is wherever the server says it now is.
 */

import { useNavigate } from 'react-router-dom';
import AIEventAssistant from '@/components/templates/AIEventAssistant';
import { JourneyShell } from '@/features/onboarding/JourneyShell';
import { useFunnelState } from '@/features/onboarding/useOnboardingJourney';
import { ONBOARDING_ROUTE } from '@/features/onboarding/journeyRoutes';

export function PlannerChatStep() {
  const { refresh } = useFunnelState();
  const navigate = useNavigate();

  const advance = async () => {
    // The turn is recorded server-side by /api/ai/chat itself; refreshing
    // the funnel updates the rail. Forward is positional — a heuristic-only
    // deployment never marks `chat` complete, and a user who has just
    // confirmed an extraction should meet the next question, not the same
    // screen again.
    await refresh();
    navigate(ONBOARDING_ROUTE.organizerProfile);
  };

  return (
    <JourneyShell
      step="chat"
      heading="Plan an event with your AI assistant"
      description="Tell it what you are organising in your own words. You have 3 free turns — one is enough to see how this works."
    >
      <AIEventAssistant onComplete={() => void advance()} onBack={() => navigate('/dashboard')} />
    </JourneyShell>
  );
}
