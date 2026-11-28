/**
 * `ai_lifecycle` — where the assistant should help, across the event's life.
 * The server derives this step's completion from any one of the three arrays
 * being non-empty, so the screen's CTA unlocks on the first chip and the
 * three groups are one decision, not three.
 *
 * THE OPTIONS ARE CLIENT-CHOSEN STRINGS, NOT AN ENUM
 *   `ai_before`/`ai_during`/`ai_after` are `z.array(z.string().max(64))`
 *   (packages/core/src/contracts/billing.ts) — the server stores whatever
 *   short strings arrive. That freedom is for the answers, not for drifting
 *   copy: these lists are one vocabulary shared by the rail and the CTA, and
 *   changing a label here changes what research reads, so a relabel is a
 *   data migration, not a copy edit.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { JourneyShell } from '@/features/onboarding/JourneyShell';
import { useFunnelSave, useFunnelState } from '@/features/onboarding/useOnboardingJourney';
import { ONBOARDING_ROUTE } from '@/features/onboarding/journeyRoutes';

interface ChipGroup {
  key: 'ai_before' | 'ai_during' | 'ai_after';
  label: string;
  hint: string;
  options: string[];
}

const GROUPS: ChipGroup[] = [
  {
    key: 'ai_before',
    label: 'Before the event',
    hint: 'Planning, budgeting, inviting',
    options: ['Draft the plan', 'Set a budget', 'Write invites', 'Choose a theme'],
  },
  {
    key: 'ai_during',
    label: 'During the event',
    hint: 'Check-in, keeping things moving',
    options: ['Guest check-in', 'Run the schedule', 'Live updates'],
  },
  {
    key: 'ai_after',
    label: 'After the event',
    hint: 'Wrapping up, saying thanks',
    options: ['Draft the recap', 'Thank-you notes', 'Collect photos'],
  },
];

const chipClass = (selected: boolean) =>
  [
    'rounded-full border px-4 py-2 text-sm transition',
    selected
      ? 'border-orange-400 bg-orange-50 text-orange-700 font-medium'
      : 'border-input bg-card text-foreground hover:border-orange-200',
  ].join(' ');

type Picks = Record<ChipGroup['key'], string[]>;

function toggle(picks: Picks, key: ChipGroup['key'], option: string): Picks {
  const current = picks[key];
  return {
    ...picks,
    [key]: current.includes(option)
      ? current.filter((o) => o !== option)
      : [...current, option],
  };
}

export function AiWorkflowStep() {
  const { state } = useFunnelState();
  const { save, isSaving } = useFunnelSave();
  const navigate = useNavigate();

  const [picks, setPicks] = useState<Picks>({
    ai_before: state?.answers.ai_before ?? [],
    ai_during: state?.answers.ai_during ?? [],
    ai_after: state?.answers.ai_after ?? [],
  });
  const [error, setError] = useState<string | null>(null);

  const anyPick = picks.ai_before.length > 0 || picks.ai_during.length > 0 || picks.ai_after.length > 0;

  const handleSubmit = async () => {
    if (!anyPick || isSaving) return;
    setError(null);

    // All three arrays are sent, including empty ones: an explicit empty
    // array IS a meaningful answer ("none of these"), which is why the
    // server keys absence rather than emptiness. The arrays this user
    // cleared should not survive as stale research.
    const outcome = await save({
      ai_before: picks.ai_before,
      ai_during: picks.ai_during,
      ai_after: picks.ai_after,
    });
    if (!outcome.ok) {
      setError(outcome.message ?? 'Could not save that. Try again.');
      return;
    }
    // Forward is positional; the shell's guard refuses locked steps, so the
    // wall cannot be walked around. See OrganizerProfileStep for why the
    // server's `current_step` is not followed after a save.
    navigate(ONBOARDING_ROUTE.plan);
  };

  return (
    <JourneyShell
      step="ai_lifecycle"
      heading="Where should AI help?"
      description="Pick anything that sounds useful, at any stage. One is enough."
    >
      <div className="space-y-6">
        {GROUPS.map((group) => (
          <fieldset key={group.key}>
            <legend className="text-sm font-medium text-foreground">{group.label}</legend>
            <p className="text-xs text-muted-foreground">{group.hint}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {group.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={picks[group.key].includes(option)}
                  onClick={() => setPicks((prev) => toggle(prev, group.key, option))}
                  className={chipClass(picks[group.key].includes(option))}
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-primary">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!anyPick || isSaving}
        className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : 'Continue'}
      </button>
      {!anyPick ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Choose at least one to continue.
        </p>
      ) : null}
    </JourneyShell>
  );
}
