/**
 * `autonomy` — how much the assistant should do without being asked.
 *
 * THE LAST SERVER STEP, NOT THE LAST SCREEN
 *   The union funnel continues past this screen with the closing pair —
 *   ProfileStep (identity) then PaymentStep (the trial, and the journey's
 *   real exit). This screen hands off to the pair; `completed: true` — the
 *   one-way cohort marker — belongs to PaymentStep, mirroring the mobile
 *   journey where the payment route sends it.
 *
 * `autonomy_level` IS THE COMPLETION KEY
 *   The server derives this step from `autonomy_level !== null`. The
 *   `agentic_wants` chips and the free-text pain are research that ride
 *   along in the same PATCH and must not gate the CTA, or a user with no
 *   opinion is stranded on the last server step.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JourneyShell } from '@/features/onboarding/JourneyShell';
import { useFunnelSave, useFunnelState, type FunnelAnswers } from '@/features/onboarding/useOnboardingJourney';
import { ONBOARDING_ROUTE } from '@/features/onboarding/journeyRoutes';

type AutonomyLevel = NonNullable<FunnelAnswers['autonomy_level']>;

const LEVELS: Array<{ value: AutonomyLevel; label: string; hint: string }> = [
  { value: 'suggest', label: 'Tell me what you would do', hint: 'Advice only; I do everything myself' },
  { value: 'draft', label: 'Write it, I will send it', hint: 'Drafts ready for my review' },
  { value: 'act_with_approval', label: 'Do it, but ask first', hint: 'Acts once I approve each step' },
  { value: 'act_autonomously', label: 'Do it and tell me afterwards', hint: 'Runs the busywork end to end' },
];

const AGENTIC_WANTS = ['Send invitations', 'Chase RSVPs', 'Draft the recap', 'Reorder the schedule', 'Remind me about vendors'];

const choiceClass = (selected: boolean) =>
  [
    'w-full rounded-xl border-2 bg-card p-4 text-left transition',
    selected ? 'border-orange-400 ring-2 ring-orange-100' : 'border-input hover:border-orange-200',
  ].join(' ');

const chipClass = (selected: boolean) =>
  [
    'rounded-full border px-4 py-2 text-sm transition',
    selected
      ? 'border-orange-400 bg-orange-50 text-orange-700 font-medium'
      : 'border-input bg-card text-foreground hover:border-orange-200',
  ].join(' ');

export function AssistantAutonomyStep() {
  const { state } = useFunnelState();
  const { save, isSaving } = useFunnelSave();
  const navigate = useNavigate();

  const [level, setLevel] = useState<AutonomyLevel | null>(state?.answers.autonomy_level ?? null);
  const [wants, setWants] = useState<string[]>(state?.answers.agentic_wants ?? []);
  const [pain, setPain] = useState(state?.answers.biggest_pain ?? '');
  const [error, setError] = useState<string | null>(null);

  const toggleWant = (want: string) => {
    setWants((prev) =>
      prev.includes(want) ? prev.filter((w) => w !== want) : [...prev, want],
    );
  };

  const handleFinish = async () => {
    if (level === null || isSaving) return;
    setError(null);

    const patch: Parameters<typeof save>[0] = {
      autonomy_level: level,
    };
    // Optional research rides along only when answered; the server keys
    // absence rather than emptiness, so an untouched field stays untouched.
    if (wants.length > 0) patch.agentic_wants = wants;
    const trimmedPain = pain.trim();
    if (trimmedPain.length > 0) patch.biggest_pain = trimmedPain.slice(0, 500);

    const outcome = await save(patch);
    if (!outcome.ok) {
      setError(outcome.message ?? 'Could not save that. Try again.');
      return;
    }
    // The closing pair continues the journey: identity first, billing after
    // it. ProfileStep navigates onward to PaymentStep, which owns the
    // `completed` marker and the exit to the dashboard.
    navigate(ONBOARDING_ROUTE.profile);
  };

  return (
    <JourneyShell
      step="autonomy"
      heading="How much should your assistant do?"
      description="You are in control — this sets how much the assistant does without asking."
    >
      <fieldset className="space-y-3">
        {LEVELS.map(({ value, label, hint }) => (
          <button
            key={value}
            type="button"
            onClick={() => setLevel(value)}
            aria-pressed={level === value}
            className={choiceClass(level === value)}
          >
            <span className="block font-semibold text-foreground">{label}</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span>
          </button>
        ))}
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-foreground">What should it handle? (optional)</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {AGENTIC_WANTS.map((want) => (
            <button
              key={want}
              type="button"
              aria-pressed={wants.includes(want)}
              onClick={() => toggleWant(want)}
              className={chipClass(wants.includes(want))}
            >
              {want}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-6">
        <label htmlFor="biggest-pain" className="text-sm font-medium text-foreground">
          What is the hardest part of organising? (optional)
        </label>
        <Input
          id="biggest-pain"
          value={pain}
          maxLength={500}
          onChange={(e) => setPain(e.target.value)}
          placeholder="One sentence is plenty"
          className="mt-2"
        />
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-primary">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleFinish()}
        disabled={level === null || isSaving}
        className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : 'Finish setup'}
      </button>
      <Button variant="ghost" className="mt-2 w-full" onClick={() => navigate('/dashboard')}>
        Come back to this later
      </Button>
    </JourneyShell>
  );
}
