/**
 * `who_you_are` — the organizer-profile screen. The server derives this
 * step's completion from `organizer_type !== null`, and the same answer is
 * the product's segmentation key, so it is saved the moment it is chosen
 * rather than held to the end of the funnel. `events_per_year` and
 * `typical_guest_count` ride along in the same PATCH: all three are stored
 * columns the research can read, and the server accepts them together.
 *
 * THIS IS NOT THE WEB ROLE PICKER
 *   /role-selection (src/components/RoleSelection.tsx) writes a role to
 *   localStorage only and the server never sees it. This screen writes the
 *   server's actual segmenter. Keeping both screens' copy aligned matters
 *   less than keeping their storage distinct, and the routing keeps them
 *   distinct by name.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { JourneyShell } from '@/features/onboarding/JourneyShell';
import {
  useFunnelSave,
  useFunnelState,
  type FunnelAnswerPatch,
  type FunnelAnswers,
} from '@/features/onboarding/useOnboardingJourney';
import { ONBOARDING_ROUTE } from '@/features/onboarding/journeyRoutes';

type OrganizerType = NonNullable<FunnelAnswers['organizer_type']>;
type EventsPerYear = NonNullable<FunnelAnswers['events_per_year']>;
type GuestCount = NonNullable<FunnelAnswers['typical_guest_count']>;

const ORGANIZER_TYPES: Array<{ value: OrganizerType; label: string; hint: string }> = [
  { value: 'personal', label: 'Personal', hint: 'Birthdays, dinners, trips with friends' },
  { value: 'professional', label: 'Professional', hint: 'Team events, offsites, launches' },
  { value: 'corporate', label: 'Corporate', hint: 'Company events at scale' },
  { value: 'community', label: 'Community', hint: 'Meetups, groups, local scenes' },
];

const EVENTS_PER_YEAR: EventsPerYear[] = ['1-2', '3-10', '11-50', '50+'];
const GUEST_COUNTS: Array<{ value: GuestCount; label: string }> = [
  { value: 'under-20', label: 'Under 20' },
  { value: '20-50', label: '20–50' },
  { value: '51-150', label: '51–150' },
  { value: 'over-150', label: 'Over 150' },
];

function choiceClass(selected: boolean): string {
  return [
    'w-full rounded-xl border-2 bg-card p-4 text-left transition',
    selected ? 'border-orange-400 ring-2 ring-orange-100' : 'border-input hover:border-orange-200',
  ].join(' ');
}

const chipClass = (selected: boolean) =>
  [
    'rounded-full border px-4 py-2 text-sm transition',
    selected
      ? 'border-orange-400 bg-orange-50 text-orange-700 font-medium'
      : 'border-input bg-card text-foreground hover:border-orange-200',
  ].join(' ');

export function OrganizerProfileStep() {
  const { state } = useFunnelState();
  const { save, isSaving } = useFunnelSave();
  const navigate = useNavigate();

  const [organizerType, setOrganizerType] = useState<OrganizerType | null>(
    state?.answers.organizer_type ?? null,
  );
  const [eventsPerYear, setEventsPerYear] = useState<EventsPerYear | null>(
    state?.answers.events_per_year ?? null,
  );
  const [guestCount, setGuestCount] = useState<GuestCount | null>(
    state?.answers.typical_guest_count ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (organizerType === null || isSaving) return;
    setError(null);

    // Only keys actually chosen are sent. Absence is meaningful to the
    // server's PATCH (it does not blank what it does not receive), and the
    // two scale questions are optional research this screen must not force.
    const patch: FunnelAnswerPatch = { organizer_type: organizerType };
    if (eventsPerYear !== null) patch.events_per_year = eventsPerYear;
    if (guestCount !== null) patch.typical_guest_count = guestCount;

    const outcome = await save(patch);
    if (!outcome.ok) {
      setError(outcome.message ?? 'Could not save that. Try again.');
      return;
    }
    // Forward is positional, not the server's `current_step`: an
    // unconfigured-LLM deployment keeps `chat` current forever (heuristic
    // turns are never billable), so following it here would bounce a user
    // who has just answered back to the planner. The shell's own guard
    // still refuses any step the server marks locked, so a user cannot
    // walk past the wall this way.
    //
    // The next screen is the location pause, mirroring the mobile journey's
    // order (role → location → …). It is enrichment with a skip, so it adds
    // one optional stop between this answer and the AI questions.
    navigate(ONBOARDING_ROUTE.whereYouHost);
  };

  return (
    <JourneyShell
      step="who_you_are"
      heading="About your events"
      description="So the assistant can plan the way you actually organise. This takes one tap."
    >
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">What kind of events do you run?</legend>
        {ORGANIZER_TYPES.map(({ value, label, hint }) => (
          <button
            key={value}
            type="button"
            onClick={() => setOrganizerType(value)}
            aria-pressed={organizerType === value}
            className={choiceClass(organizerType === value)}
          >
            <span className="block font-semibold text-foreground">{label}</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span>
          </button>
        ))}
      </fieldset>

      <fieldset className="mt-6 space-y-3">
        <legend className="text-sm font-medium text-foreground">How often? (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {EVENTS_PER_YEAR.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setEventsPerYear(value)}
              aria-pressed={eventsPerYear === value}
              className={chipClass(eventsPerYear === value)}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6 space-y-3">
        <legend className="text-sm font-medium text-foreground">Typical guest count? (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {GUEST_COUNTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setGuestCount(value)}
              aria-pressed={guestCount === value}
              className={chipClass(guestCount === value)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-primary">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={organizerType === null || isSaving}
        className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : 'Continue'}
      </button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Picks a kind to continue. The two optional questions can be skipped.
      </p>
    </JourneyShell>
  );
}
