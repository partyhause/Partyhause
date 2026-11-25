/**
 * The frame every journey screen renders inside: progress rail, heading,
 * and the server-authoritative step guard.
 *
 * THE SERVER DECIDES WHICH SCREEN IS NEXT
 *   `flow.current_step` is computed server-side from the answers that exist
 *   and the caller's entitlement (server/lib/onboarding-flow.ts). A client
 *   visiting a step ahead of that answer is redirected to the server's step,
 *   so deep links, stale history entries and the browser's back button all
 *   land on the one screen the account is actually owed. The mobile
 *   equivalent is the /onboarding layout guard, for the same reasons.
 *
 * FAILING OPEN
 *   When /api/onboarding cannot be read, the children render anyway: the
 *   research screens must stay answerable across a failed read, and the
 *   answers PATCH returns a fresh flow, which recovers the rail by itself.
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';
import { ProgressStepper, type Step } from '@/components/ui/progress-stepper';
import { useFunnelState, type FunnelStepId } from '@/features/onboarding/useOnboardingJourney';
import {
  FUNNEL_STEPS,
  STEP_LABELS,
  routeForCurrentStep,
} from '@/features/onboarding/journeyRoutes';

interface JourneyShellProps {
  /** The step this route renders. The guard checks it against the server's. */
  step: FunnelStepId;
  /** The screen's heading. */
  heading: string;
  /** One short line saying what the screen asks. */
  description: string;
  children: ReactNode;
}

export function JourneyShell({ step, heading, description, children }: JourneyShellProps) {
  const { state, isLoading } = useFunnelState();
  const location = useLocation();
  const navigate = useNavigate();

  // First load. Same full-screen spinner the username gate uses, so the
  // journey does not read as a blank page that flashes in.
  if (isLoading) {
    return <Loading fullScreen size="lg" />;
  }

  const current = state?.flow.current_step ?? null;

  // The server's `locked` flag is the only reachability signal this guard
  // honours — it is true only for the wall and what follows it, and only
  // while the account is unentitled (server/lib/onboarding-flow.ts). A user
  // who confirmed the planner's extraction on an unconfigured-LLM
  // deployment settles that turn as `heuristic`, so `ai.used` stays 0 and
  // the server keeps naming `chat` as current forever; keying the guard on
  // position equality would bounce them off every later screen back to the
  // planner, which is a redirect loop wearing a progress rail. Reachability,
  // not position, is the contract.
  if (state) {
    // A completed journey has no screen to show: every step route would
    // redirect in a circle if it stayed, so completed callers leave first.
    if (state.flow.completed) {
      return <Navigate to="/dashboard" replace />;
    }
    const thisStep = state.flow.steps.find((s) => s.id === step);
    if (thisStep?.locked) {
      const owed = routeForCurrentStep(current);
      if (owed !== null && location.pathname !== owed) {
        return <Navigate to={owed} replace />;
      }
    }
  }

  // Fail open: no state means no known step, so the rail renders this
  // route's own step and the screens stay answerable. Blocking them over a
  // failed read is the lockout this shell exists to avoid.
  const steps: Step[] = FUNNEL_STEPS.map((id) => ({ id, label: STEP_LABELS[id] }));
  const completedSteps = state
    ? state.flow.steps.filter((s) => s.complete).map((s) => s.id)
    : [];
  const railStep = current ?? step;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Leave setup and go to your dashboard"
            onClick={() => navigate('/dashboard')}
          >
            <X className="h-4 w-4" /> Leave setup
          </Button>
        </div>
        <ProgressStepper
          steps={steps}
          currentStep={railStep}
          completedSteps={completedSteps}
          className="mb-8"
        />
        <h1 className="text-2xl font-semibold text-foreground">{heading}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
