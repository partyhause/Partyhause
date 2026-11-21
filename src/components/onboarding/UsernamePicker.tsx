/**
 * The username field: input, live availability, suggestions, submit.
 *
 * Used in two places with the same code, because they are the same decision
 * made at two moments: the onboarding gate a new user meets after verifying
 * their email, and the settings surface where an existing user changes their
 * handle later. Splitting them would mean maintaining two copies of the
 * availability wiring, which is exactly how the two HTTP clients in this
 * repository came to disagree.
 *
 * COLOUR
 *   The solid button is `coral-700 #C02A16`, not `--primary`. docs/BRAND.md
 *   section 4.1 records that white on `coral-500 #FF5233` measures 3.23:1 and
 *   fails WCAG 2.1 AA for body text, and that the app ships that exact pair on
 *   every button today. New surfaces do not inherit a known defect; coral-700
 *   measures 5.86:1 and passes. The focus ring is `coral-600 #EA361A` per
 *   section 4.2, which is the lightest step that passes 1.4.11 on the tinted
 *   surfaces this app actually uses.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import {
  useUsernameActions,
  useUsernameAvailability,
  type OnboardingState,
} from '@/hooks/use-onboarding';

/** docs/BRAND.md section 4.1 and 4.3. */
const CORAL_700 = '#C02A16';
const CORAL_600 = '#EA361A';

interface UsernamePickerProps {
  /** Server-supplied limits, suggestions and current handle. */
  state: OnboardingState;
  /** Rendered above the field. */
  heading: string;
  /** Rendered under the heading. */
  description: string;
  /** Label for the confirm control. */
  submitLabel: string;
  /** Shown when the picker may be dismissed. Omit to hide the control. */
  onSkip?: () => void;
  /** Called after a successful claim. */
  onDone?: () => void;
}

/**
 * Strip characters the server will refuse, as the user types.
 *
 * Filtering rather than warning, for one class of input only: characters
 * outside the allowed alphabet. Typing a space into a handle field is a slip,
 * not an intention, and silently dropping it is kinder than a red sentence.
 * Every other rule (length, reserved words, underscore placement) produces a
 * message instead, because those are real choices the user made.
 *
 * @param raw The value from the input event.
 * @param maxLength Server-supplied upper bound.
 * @returns The value to put back into the field.
 */
function sanitizeTyping(raw: string, maxLength: number): string {
  return raw.replace(/[^A-Za-z0-9_]/g, '').slice(0, maxLength);
}

export function UsernamePicker({
  state,
  heading,
  description,
  submitLabel,
  onSkip,
  onDone,
}: UsernamePickerProps) {
  const [value, setValue] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { claim, skip, isSubmitting } = useUsernameActions();
  const limits = state.limits ?? {
    min_length: 3,
    max_length: 30,
    cooldown_days: 30,
    max_suggestions: 5,
  };

  // Only offer the existing handle back as a starting value when the user
  // actually chose it. Pre-filling the assigned u_<base36> handle would put the
  // thing this screen exists to replace into the field.
  const seedValue = state.has_chosen_username ? state.username : '';
  useEffect(() => {
    setValue(seedValue);
  }, [seedValue]);

  const status = useUsernameAvailability(
    value,
    limits.min_length,
    state.has_chosen_username ? state.username : null,
  );

  const cooldownNotice = useMemo(() => {
    if (!state.can_change_at) return null;
    const unlocksAt = new Date(state.can_change_at);
    if (Number.isNaN(unlocksAt.getTime()) || unlocksAt.getTime() <= Date.now()) return null;
    return `You can change your username again on ${unlocksAt.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}.`;
  }, [state.can_change_at]);

  const locked = cooldownNotice !== null;
  const canSubmit = status.kind === 'available' && !isSubmitting && !locked;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitError(null);
    const outcome = await claim(value.trim());
    if (!outcome.ok) {
      setSubmitError(outcome.message ?? 'Could not save that username. Try again.');
      return;
    }
    onDone?.();
  };

  const handleSkip = async () => {
    setSubmitError(null);
    const outcome = await skip();
    if (!outcome.ok) {
      setSubmitError(outcome.message ?? 'Could not dismiss this. Try again.');
      return;
    }
    onSkip?.();
  };

  return (
    <div className="w-full max-w-md">
      <h1 className="text-2xl font-semibold text-foreground">{heading}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>

      {state.username_is_generated ? (
        <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          You are currently <span className="font-mono font-medium">@{state.username}</span>, which
          was assigned automatically.
        </p>
      ) : null}

      <div className="mt-6">
        <label htmlFor="username-picker" className="text-sm font-medium text-foreground">
          Username
        </label>
        <div className="relative mt-2">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            @
          </span>
          <input
            id="username-picker"
            name="username"
            value={value}
            onChange={(event) =>
              setValue(sanitizeTyping(event.target.value, limits.max_length))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={isSubmitting || locked}
            placeholder="yourname"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={limits.max_length}
            aria-describedby="username-picker-status"
            aria-invalid={status.kind === 'unavailable' || status.kind === 'error'}
            className="w-full rounded-lg border border-input bg-background py-2.5 pl-7 pr-10 font-mono text-base text-foreground outline-none transition focus:border-transparent focus:ring-2 disabled:opacity-60"
            style={{ ['--tw-ring-color' as string]: CORAL_600 }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {status.kind === 'checking' ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : null}
            {status.kind === 'available' ? (
              <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            ) : null}
            {status.kind === 'unavailable' || status.kind === 'error' ? (
              <AlertCircle className="h-4 w-4" style={{ color: CORAL_700 }} aria-hidden="true" />
            ) : null}
          </span>
        </div>

        {/*
          aria-live so a screen reader announces the verdict without the user
          having to navigate back to the field to discover it changed.
        */}
        <p
          id="username-picker-status"
          role="status"
          aria-live="polite"
          className="mt-2 min-h-[1.25rem] text-sm"
        >
          {status.kind === 'checking' ? (
            <span className="text-muted-foreground">Checking availability...</span>
          ) : null}
          {status.kind === 'available' ? (
            <span className="text-emerald-700">@{status.username} is available.</span>
          ) : null}
          {status.kind === 'unavailable' || status.kind === 'error' ? (
            <span style={{ color: CORAL_700 }}>{status.message}</span>
          ) : null}
        </p>
      </div>

      {state.suggestions.length > 0 && !state.has_chosen_username ? (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">Suggestions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {state.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setValue(suggestion)}
                disabled={isSubmitting || locked}
                className="rounded-full border border-input px-3 py-1.5 font-mono text-sm text-foreground transition hover:bg-muted disabled:opacity-60"
              >
                @{suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {cooldownNotice ? (
        <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {cooldownNotice}
        </p>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          {limits.min_length} to{' '}
          {limits.max_length} characters. You can change it again after{' '}
          {limits.cooldown_days} days.
        </p>
      )}

      {submitError ? (
        <p role="alert" className="mt-3 text-sm" style={{ color: CORAL_700 }}>
          {submitError}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="inline-flex h-11 w-full items-center justify-center rounded-lg text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: CORAL_700 }}
        >
          {isSubmitting ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            submitLabel
          )}
        </button>

        {onSkip ? (
          <button
            type="button"
            onClick={() => void handleSkip()}
            disabled={isSubmitting}
            className="h-11 w-full rounded-lg text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
          >
            Not now
          </button>
        ) : null}
      </div>
    </div>
  );
}
