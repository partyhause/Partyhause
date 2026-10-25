/**
 * `/onboarding/role` — the mobile journey's role screen, on the web.
 *
 * "What brings you here?" with the four organizer types the server's
 * segmentation reads. The organizer_type PATCH fires the moment a choice is
 * made rather than on Continue, mirroring the mobile route
 * (apps/mobile/app/onboarding/role.tsx): the server derives the who_you_are
 * step's completion from `organizer_type !== null`, so a user who chooses and
 * closes the tab has still answered, and the choice is the product's
 * segmentation key — worth keeping even when nothing after it is.
 *
 * A FAILED SAVE STOPS THE JOURNEY
 *   Same rule as mobile: continuing would leave the server asking the same
 *   question again on the next login, which reads as the choice being
 *   ignored. The error renders inline and Continue stays where it is.
 *
 * THIS IS NOT THE WEB ROLE PICKER
 *   /role-selection (src/components/RoleSelection.tsx) writes a role to
 *   localStorage only and the server never sees it. This screen writes the
 *   server's actual segmenter.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { apiPatch } from '@/lib/api-client';
import { useFunnelState, type FunnelAnswers } from '@/features/onboarding/useOnboardingJourney';
import { ONBOARDING_ROUTE } from '@/features/onboarding/journeyRoutes';

/** docs/BRAND.md section 4.1: coral-700 passes AA for text, the 500 does not. */
const CORAL_700 = '#C02A16';

type OrganizerType = NonNullable<FunnelAnswers['organizer_type']>;

/** Verbatim from the mobile screen: components/screens/OnboardingRoleSelectionScreen.tsx. */
const ROLES: Array<{ id: OrganizerType; label: string; hint: string }> = [
  { id: 'personal', label: 'I host events', hint: 'Birthdays, dinners, parties with friends' },
  { id: 'professional', label: 'I’m a vendor', hint: 'You supply the parties — venues, catering, services' },
  { id: 'corporate', label: 'I host for a company', hint: 'Team events, offsites, launches' },
  { id: 'community', label: 'I’m exploring', hint: 'Meetups, groups, local scenes' },
];

export function RoleStep() {
  const { state } = useFunnelState();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<OrganizerType | null>(
    state?.answers.organizer_type ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (role: OrganizerType) => {
    if (saving) return;
    setSelected(role);
    setError(null);
    void (async () => {
      setSaving(true);
      try {
        const { error: saveError } = await apiPatch('/api/onboarding', {
          organizer_type: role,
        });
        if (saveError) {
          setError(saveError.message ?? 'Could not save that. Try again.');
          return;
        }
      } finally {
        setSaving(false);
      }
    })();
  };

  const continueJourney = () => {
    if (selected === null || saving) return;
    // Forward is positional, not the server's `current_step`: an
    // unconfigured-LLM deployment keeps `chat` current forever (heuristic
    // turns are never billable), so following it here would bounce a user
    // who has just answered back to the planner. The ProtectedRoute /
    // JourneyShell guards still refuse any step the server marks locked.
    navigate(ONBOARDING_ROUTE.interests);
  };

  const skip = () => {
    if (saving) return;
    navigate(ONBOARDING_ROUTE.interests);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-3xl font-bold text-foreground">What brings you here?</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Choose how you’ll use PartyHause.
        </p>

        <div className="mt-8 space-y-3">
          {ROLES.map(({ id, label, hint }) => (
            <button
              key={id}
              type="button"
              aria-pressed={selected === id}
              onClick={() => choose(id)}
              className={[
                'w-full rounded-xl border-2 bg-card p-4 text-left transition',
                selected === id
                  ? 'border-orange-400 ring-2 ring-orange-100'
                  : 'border-input hover:border-orange-200',
              ].join(' ')}
            >
              <span className="block font-medium text-foreground">{label}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>

        {saving ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 text-sm" style={{ color: CORAL_700 }}>
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={continueJourney}
          disabled={selected === null || saving}
          className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: CORAL_700 }}
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
