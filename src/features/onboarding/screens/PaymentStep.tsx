/**
 * `/onboarding/payment` — the journey's final screen, the once-per-account
 * card trial.
 *
 * PROVENANCE: `apps/mobile/app/onboarding/payment.tsx`
 *   This screen is that route on the web: activate the trial, then mark the
 *   funnel finished, then leave to the dashboard. It closes the funnel's
 *   closing pair — ProfileStep writes identity, this writes billing — and
 *   `ProfileStep` navigates here on both its Done and Skip paths, so a user
 *   who reaches the pair always ends here.
 *
 * TWO STATES, BOTH DERIVED FROM THE SERVER
 *   Entitled (the common web case): the wall was already passed at PlanStep,
 *   where starting the trial is what unlocks `autonomy`. Nothing is left to
 *   activate, so this screen states what the entitlement view says and
 *   finishes the funnel. Rendering the wall's "start your trial" copy to
 *   someone whose trial is already running would be the VendorDashboard
 *   defect in miniature: a screen reporting a state the server contradicts.
 *   Unentitled (the mobile-parity case): the real wall. `paywallCopy` is the
 *   single source for those strings, and `useTrialStart` folds
 *   TRIAL_ALREADY_USED / ALREADY_SUBSCRIBED into ok — holding entitlement
 *   clears the wall identically to starting one.
 *
 * NO FABRICATED PRICING
 *   The mobile screen renders hardcoded plan cards ("Pro, $19/mo"). No
 *   billing endpoint returns prices — /api/billing exposes entitlement,
 *   trial/start, checkout and portal — so those figures are invented data.
 *   This screen shows only what the entitlement view reports.
 *
 * WHY NO `JourneyShell`
 *   The shell's guard redirects when its `step` is `locked`, and every step
 *   after `paywall` is locked while the account is unentitled — so a shell
 *   wrapping this screen would bounce an unentitled caller back to the wall
 *   they just came from. ProfileStep renders bare for the same reason; the
 *   closing pair shares its own frame, and this screen carries the completed
 *   redirect the shell would otherwise provide.
 */

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { CARD_TRIAL_DAYS, paywallCopy } from '@partyhause/core';
import { Loading } from '@/components/ui/loading';
import {
  useFunnelSave,
  useFunnelState,
  useTrialStart,
} from '@/features/onboarding/useOnboardingJourney';

export function PaymentStep() {
  const { state, isLoading } = useFunnelState();
  const { start, isStarting } = useTrialStart();
  const { save, isSaving } = useFunnelSave();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // First read. Same full-screen spinner the shell uses, so the wall copy
  // does not flash for one frame before the entitled state replaces it.
  if (isLoading) {
    return <Loading fullScreen size="lg" />;
  }

  // A completed journey has nothing left to activate. The shell does this for
  // step routes; this screen renders without it, so it carries its own.
  if (state?.flow.completed) {
    return <Navigate to="/dashboard" replace />;
  }

  const entitlement = state?.entitlement ?? null;
  const copy = paywallCopy(entitlement?.paywall.reason ?? null);
  const daysLeft = entitlement?.trial_days_remaining ?? null;
  const busy = isStarting || isSaving;

  /** Mark the funnel finished, then leave. The marker is a cohort timestamp,
   *  not a gate — the derivation reads answers and entitlement — so a failed
   *  save warns and continues rather than trapping an entitled user here. */
  const finish = async () => {
    if (busy) return;
    const outcome = await save({ completed: true });
    if (!outcome.ok) {
      setError(outcome.message ?? 'Could not finish setup. You can continue anyway.');
      return;
    }
    navigate('/dashboard');
  };

  /** The unentitled path: activate the trial (or fold "already holds it"),
   *  then finish. Mirrors the mobile route's handler exactly. */
  const handleActivate = async () => {
    if (busy) return;
    setError(null);
    const outcome = await start();
    if (!outcome.ok) {
      setError(outcome.message ?? 'Could not start the trial. Try again.');
      return;
    }
    await finish();
  };

  // ---------------------------------------------------------------------
  // Entitled: state what the server says and finish.
  // ---------------------------------------------------------------------
  if (entitlement?.is_entitled) {
    return (
      <div className="min-h-screen bg-background px-4 py-12">
        <div className="mx-auto max-w-lg">
          <h1 className="text-3xl font-bold text-foreground">
            {entitlement.status === 'trialing' ? 'Your free trial is running' : 'Your plan is active'}
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            {entitlement.status === 'trialing' && daysLeft !== null
              ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} of the full assistant left on your ${CARD_TRIAL_DAYS}-day trial.`
              : 'Everything you configured is ready on your dashboard.'}
          </p>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-primary">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void finish()}
            disabled={isSaving}
            className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : 'Finish setup'}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Unentitled: the wall, rendered from the shared copy.
  // ---------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-3xl font-bold text-foreground">{copy.title}</h1>
        <p className="mt-2 text-base text-muted-foreground">{copy.body}</p>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-primary">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void handleActivate()}
          disabled={busy}
          className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : copy.cta}
        </button>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          disabled={busy}
          className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg text-base font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copy.dismiss}
        </button>
      </div>
    </div>
  );
}
