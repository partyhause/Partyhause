/**
 * `paywall` — the wall, rendered from the shared copy.
 *
 * The strings come from packages/core/src/paywall-copy.ts, the one place both
 * platforms agree on what the wall says — shipping a different trial length
 * here than on iOS is the chargeback that module exists to prevent. Only the
 * layout is web-native.
 *
 * THE WALL HAS AN EXIT, AND THE EXIT IS THE DASHBOARD
 *   `paywallCopy(...).dismiss` is rendered as a real leave, not a skip: the
 *   server only ever clears this step through entitlement, so there is
 *   nothing to save and no state to fake. The dashboard's setup card stays
 *   visible until the account is entitled, which is the honest shape of "you
 *   can keep using this without paying".
 *
 * `TRIAL_ALREADY_USED` / `ALREADY_SUBSCRIBED` (409) MEAN SUCCESS HERE
 *   Both mean the account holds entitlement, which is the only thing the
 *   flow derivation reads. useTrialStart folds them into ok, mirroring the
 *   mobile payment route.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import { paywallCopy } from '@partyhause/core';
import { Button } from '@/components/ui/button';
import { JourneyShell } from '@/features/onboarding/JourneyShell';
import { useFunnelState, useTrialStart } from '@/features/onboarding/useOnboardingJourney';
import { ONBOARDING_ROUTE } from '@/features/onboarding/journeyRoutes';

export function PlanStep() {
  const { state } = useFunnelState();
  const { start, isStarting } = useTrialStart();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const entitlement = state?.entitlement ?? null;
  const copy = paywallCopy(entitlement?.paywall.reason ?? null);
  const daysLeft = entitlement?.trial_days_remaining ?? null;

  const handleStartTrial = async () => {
    setError(null);
    const outcome = await start();
    if (!outcome.ok) {
      setError(outcome.message ?? 'Could not start the trial. Try again.');
      return;
    }
    // Trial started or already held. useTrialStart has refreshed the
    // funnel from the server's recomputation, and the shell guard on the
    // next screen confirms the account is really owed autonomy.
    navigate(ONBOARDING_ROUTE.assistantAutonomy);
  };

  return (
    <JourneyShell
      step="paywall"
      heading={copy.title}
      description={copy.body}
    >
      <div className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-pink-50 p-4">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" aria-hidden="true" />
          <div className="flex-1">
            {daysLeft !== null && entitlement?.status === 'trialing' ? (
              <p className="text-sm text-gray-600">
                Your trial is running — {daysLeft} day{daysLeft === 1 ? '' : 's'} left.
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                14 days of the full assistant: unlimited planning turns, autopilot options, and
                everything you have already planned stays yours after it.
              </p>
            )}
            {entitlement && !entitlement.can_start.card_14d && !entitlement.is_entitled ? (
              <p className="mt-2 text-sm text-gray-600">
                This account has already used its trial. Subscribe any time from Settings.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-primary">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleStartTrial()}
          disabled={isStarting}
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isStarting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : copy.cta}
        </button>
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>
          {copy.dismiss}
        </Button>
      </div>
    </JourneyShell>
  );
}
