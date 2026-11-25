/**
 * The dashboard's standing offer of the journey, shown only while the server
 * says the funnel is unfinished.
 *
 * WHY A CARD AND NOT A HARD GATE
 *   The mobile client hard-gates its dashboard on flow.completed, and that
 *   is correct for what it ships: every one of its screens writes the
 *   answers the server reads. The web journey adds the `chat` step, which
 *   completes only from an LLM-sourced turn (heuristic turns are never
 *   billable), so a hard gate on the web strands every user of an
 *   unconfigured-LLM deployment on screen one forever. A card offers the
 *   journey without making it a toll.
 *
 * THE SERVER NAMES THE NEXT STEP, THE CARD ONLY DISPLAYS IT
 *   `flow.current_step` picks the label; nothing here re-derives progress.
 *   A failed read hides the card (fail open), never invents one.
 */

import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PastelCard } from '@/components/ui/PastelCard';
import { useFunnelState } from '@/features/onboarding/useOnboardingJourney';
import { STEP_LABELS, routeForCurrentStep } from '@/features/onboarding/journeyRoutes';

export function JourneySetupCard() {
  const { state, isLoading } = useFunnelState();
  const navigate = useNavigate();

  // Loading or unreadable: offer nothing rather than something wrong.
  if (isLoading || !state || state.flow.completed || state.flow.current_step === null) {
    return null;
  }

  const target = routeForCurrentStep(state.flow.current_step);
  if (target === null) return null;

  const answered = state.flow.steps.filter((s) => s.complete).length;
  const total = state.flow.steps.length;

  return (
    <div className="mb-4">
      <button type="button" onClick={() => navigate(target)} className="w-full text-left">
        <PastelCard variant="peach">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">
                Finish setting up — {STEP_LABELS[state.flow.current_step]}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {answered} of {total} done. Takes about a minute.
              </p>
            </div>
            <ArrowRight className="h-5 w-5 flex-shrink-0 text-orange-500" aria-hidden="true" />
          </div>
        </PastelCard>
      </button>
    </div>
  );
}
