/**
 * `/onboarding/interests` — the mobile journey's interests screen, on the
 * web. The event-type chips ("Birthday", "Wedding", ...), max three.
 *
 * THE SCREEN THAT USED TO THROW ITS ANSWER AWAY
 *   On mobile this answer was a documented no-op: the route called
 *   saveOnboardingData({interests}), whose body is a comment explaining it
 *   persists nothing (apps/mobile/lib/onboarding.ts). The web port persists
 *   for real, to onboarding_responses.event_interests — the column added for
 *   exactly this answer (migration 20261022000000_onboarding_interests),
 *   because overloading agentic_wants with event-type chips would make both
 *   answers unreadable.
 *
 * THE MAX-THREE RULE, KEPT AND MADE HONEST
 *   Mobile ignores the fourth tap silently. Silent refusal reads as a broken
 *   button, so the web shows a one-line "Pick three at most" the moment a
 *   fourth chip is refused, and the counter in the subtitle tracks the
 *   selection. Deselection always works.
 *
 * ENRICHMENT, NOT A GATE
 *   Same contract as the location screen: a failed save warns and the
 *   journey continues. Interests shape what the product surfaces later; they
 *   are not an entitlement and must never become a toll.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { apiPatch } from '@/lib/api-client';
import { ONBOARDING_ROUTE } from '@/features/onboarding/journeyRoutes';

/** Verbatim from the mobile screen: components/screens/OnboardingInterestsScreen.tsx. */
const INTERESTS = ['Birthday', 'Wedding', 'Corporate', 'Community', 'House Party', 'Festival', 'Other'] as const;

/** The contract's cap: z.array(...).max(20) — but the screen's own rule is 3. */
const MAX_PICKS = 3;

export function InterestsStep() {
  const navigate = useNavigate();

  const [selected, setSelected] = useState<string[]>([]);
  const [refused, setRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (interest: string) => {
    setRefused(false);
    setSelected((prev) => {
      if (prev.includes(interest)) return prev.filter((i) => i !== interest);
      if (prev.length >= MAX_PICKS) {
        setRefused(true);
        return prev;
      }
      return [...prev, interest];
    });
  };

  const continueJourney = () => {
    if (saving) return;
    void (async () => {
      setSaving(true);
      setError(null);
      try {
        // An empty selection is a real answer ("none of these" so far) and
        // the server accepts it; only a failed save blocks nothing here.
        const { error: saveError } = await apiPatch('/api/onboarding', {
          event_interests: selected,
        });
        if (saveError) {
          setError(saveError.message ?? 'Could not save that. You can continue and set it later.');
        }
      } finally {
        setSaving(false);
      }
      navigate(ONBOARDING_ROUTE.organizerProfile);
    })();
  };

  const skip = () => {
    if (saving) return;
    navigate(ONBOARDING_ROUTE.organizerProfile);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-3xl font-bold text-foreground">
          What kind of events do you love?
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Pick up to {MAX_PICKS}. This helps us surface relevant
          templates.{selected.length > 0 ? ` ${selected.length} of ${MAX_PICKS} picked.` : ''}
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          {INTERESTS.map((interest) => {
            const active = selected.includes(interest);
            return (
              <button
                key={interest}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(interest)}
                className={[
                  'rounded-full border px-4 py-2 text-sm transition',
                  active
                    ? 'border-orange-400 bg-orange-50 text-orange-700 font-medium'
                    : 'border-input bg-card text-foreground hover:border-orange-200',
                ].join(' ')}
              >
                {interest}
              </button>
            );
          })}
        </div>

        {refused ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Pick {MAX_PICKS} at most. Deselect one to swap it.
          </p>
        ) : null}
        {saving ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-primary">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={continueJourney}
          disabled={saving}
          className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
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
