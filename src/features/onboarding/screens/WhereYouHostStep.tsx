/**
 * `/onboarding/where` — where you host. The web replication of the mobile
 * journey's location screen (`apps/mobile/app/onboarding/location.tsx`).
 *
 * ENRICHMENT, NOT A GATE
 *   On mobile the city/region/country answer is enrichment: the screen has a
 *   skip, a failed save only warns, and the journey continues regardless
 *   (`location.tsx:14-19`). That contract is kept here exactly. The server's
 *   funnel has no `location` step id, so this screen is not part of the
 *   server's step machine — like welcome, it renders standalone and hands
 *   back to the server-named step, preserving "the server decides which
 *   screen is next" for every question the funnel actually tracks.
 *
 * PERSISTENCE
 *   The location string is a whitelisted profile field (`PUT /api/users/me/profile`
 *   accepts `location`, max 120 chars, server-routes/users.ts:203-207), stored
 *   joined exactly the way mobile joins it: `city, region, country`, blank
 *   parts dropped. It is clearable later from settings by sending ''.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { apiPut } from '@/lib/api-client';
import { useFunnelState } from '@/features/onboarding/useOnboardingJourney';
import { routeForCurrentStep } from '@/features/onboarding/journeyRoutes';

/** docs/BRAND.md section 4.1: coral-700 passes AA for text, the 500 does not. */
const CORAL_700 = '#C02A16';

/** The server's cap for the profile location field. */
const LOCATION_MAX = 120;

export function WhereYouHostStep() {
  const { state } = useFunnelState();
  const navigate = useNavigate();

  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parts = [city.trim(), region.trim(), country.trim()].filter(Boolean);
  const joined = parts.join(', ');
  const canContinue = parts.length > 0 && joined.length <= LOCATION_MAX && !saving;

  /** The step the server says is owed after this pause. Never re-derived. */
  const next =
    (state && !state.flow.completed && routeForCurrentStep(state.flow.current_step)) ||
    '/onboarding/planner-chat';

  const saveAndContinue = async () => {
    if (!canContinue) return;
    setSaving(true);
    setError(null);
    try {
      // Same contract as mobile: a failed save warns but never blocks
      // (location is enrichment, clearable any time from settings).
      const { error: saveError } = await apiPut('/api/users/me/profile', { location: joined });
      if (saveError) {
        setError(saveError.message ?? 'Could not save that. You can continue and set it later.');
      }
    } finally {
      setSaving(false);
    }
    // Continue regardless of the save outcome — the mobile screen does the
    // same (console.warn, then push). Enrichment must never become a toll.
    navigate(next);
  };

  const skip = () => {
    if (saving) return;
    navigate(next);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-center text-3xl font-bold text-foreground">
          Where do you host?
        </h1>
        <p className="mt-3 text-center text-base text-muted-foreground">
          Helps us show nearby events and vendors. Optional.
        </p>

        <div className="mt-10 space-y-4">
          <label className="block">
            <span className="sr-only">City</span>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              maxLength={LOCATION_MAX}
              className="h-11 w-full rounded-lg border border-input bg-card px-4 text-foreground placeholder:text-muted-foreground focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <label className="block">
            <span className="sr-only">Region or state</span>
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="Region / State"
              maxLength={LOCATION_MAX}
              className="h-11 w-full rounded-lg border border-input bg-card px-4 text-foreground placeholder:text-muted-foreground focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <label className="block">
            <span className="sr-only">Country</span>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Country"
              maxLength={LOCATION_MAX}
              className="h-11 w-full rounded-lg border border-input bg-card px-4 text-foreground placeholder:text-muted-foreground focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100"
            />
          </label>
        </div>

        {joined.length > LOCATION_MAX ? (
          <p role="alert" className="mt-3 text-sm" style={{ color: CORAL_700 }}>
            That is longer than {LOCATION_MAX} characters. Try just the city.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm" style={{ color: CORAL_700 }}>
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void saveAndContinue()}
          disabled={!canContinue}
          className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: CORAL_700 }}
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : 'Continue'}
        </button>
        <button
          type="button"
          onClick={skip}
          disabled={saving}
          className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg text-base font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
