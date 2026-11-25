/**
 * Onboarding and username state for the web client.
 *
 * ONE FETCH PER SESSION, NOT ONE PER PAGE
 *   The gate lives inside `ProtectedRoute`, which mounts on every authenticated
 *   surface. A bare `useEffect` fetch there would hit
 *   `GET /api/users/me/onboarding` on every navigation. The query is therefore
 *   held in TanStack Query with an infinite stale time and invalidated
 *   explicitly after a claim or a skip, which are the only two things that can
 *   change the answer.
 *
 * THE SERVER OWNS THE POLICY
 *   Nothing here re-implements `server/lib/username.ts`. The availability
 *   endpoint returns a displayable sentence for every refusal, so the field
 *   shows the server's own message rather than a second copy of the rules that
 *   can drift from the first. The only local check is a length floor, and it
 *   exists to avoid firing a request for a two-character string that cannot
 *   possibly be valid, not to duplicate a rule.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import { usePartyStore } from '@/store/usePartyStore';

/** Bounds the server enforces, sent so this client hardcodes none of them. */
export interface UsernameLimits {
  min_length: number;
  max_length: number;
  cooldown_days: number;
  max_suggestions: number;
}

/** The answer from `GET /api/users/me/onboarding`. */
export interface OnboardingState {
  username: string;
  display_name: string;
  username_is_generated: boolean;
  has_chosen_username: boolean;
  /** The single boolean the gate reads. Computed server-side. */
  show_picker: boolean;
  skippable: boolean;
  can_change_at: string | null;
  suggestions: string[];
  limits: UsernameLimits;
}

/** The answer from `GET /api/users/username-available`. */
export interface UsernameAvailability {
  username: string;
  available: boolean;
  code?: string;
  message?: string;
}

/** What the picker field renders beneath the input. */
export type AvailabilityStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; username: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string };

const ONBOARDING_QUERY_KEY = ['onboarding', 'me'] as const;

/** How long the field waits after the last keystroke before asking the server. */
const AVAILABILITY_DEBOUNCE_MS = 400;

/**
 * Read the caller's onboarding state.
 *
 * @returns The state, its loading and error flags, and a `refresh` that forces
 *          a re-read. `state` is null until the first successful load.
 */
export function useOnboardingState() {
  const user = usePartyStore((s) => s.user);
  const queryClient = useQueryClient();

  const query = useQuery<OnboardingState | null, Error>({
    queryKey: ONBOARDING_QUERY_KEY,
    enabled: Boolean(user),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await apiGet<OnboardingState>('/api/users/me/onboarding');
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const refresh = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
  }, [queryClient]);

  return {
    state: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
    refresh,
  };
}

/**
 * Debounced availability lookup for a username field.
 *
 * Responses are matched to the request that asked for them by sequence number,
 * so a slow answer for an earlier keystroke cannot overwrite the answer for
 * what the user has actually typed. Without that, deleting a character fast
 * enough leaves the field showing a verdict about a string that is no longer
 * in it.
 *
 * @param candidate The current field value.
 * @param minLength Length below which no request is made.
 * @param currentUsername The caller's existing handle. Typing it back is
 *                        reported as available rather than as taken, because
 *                        it is theirs.
 * @returns The status to render beneath the field.
 */
export function useUsernameAvailability(
  candidate: string,
  minLength: number,
  currentUsername: string | null,
): AvailabilityStatus {
  const [status, setStatus] = useState<AvailabilityStatus>({ kind: 'idle' });
  // Monotonic request id. A response is applied only when it is the newest.
  const sequence = useRef(0);

  useEffect(() => {
    const trimmed = candidate.trim();

    if (trimmed.length === 0) {
      setStatus({ kind: 'idle' });
      return;
    }

    if (trimmed.length < minLength) {
      setStatus({
        kind: 'unavailable',
        message: `Usernames need at least ${minLength} characters.`,
      });
      return;
    }

    if (currentUsername && trimmed.toLowerCase() === currentUsername.toLowerCase()) {
      setStatus({ kind: 'available', username: trimmed });
      return;
    }

    setStatus({ kind: 'checking' });
    const id = ++sequence.current;

    const timer = setTimeout(async () => {
      const { data, error } = await apiGet<UsernameAvailability>(
        `/api/users/username-available?username=${encodeURIComponent(trimmed)}`,
      );

      // A newer keystroke has already asked its own question. Drop this answer
      // rather than letting it describe a value the field no longer holds.
      if (id !== sequence.current) return;

      if (error) {
        setStatus({
          kind: 'error',
          message:
            error.status === 429
              ? 'Too many checks. Pause for a moment and try again.'
              : 'Could not check that username. Try again.',
        });
        return;
      }

      if (!data) {
        setStatus({ kind: 'error', message: 'Could not check that username. Try again.' });
        return;
      }

      setStatus(
        data.available
          ? { kind: 'available', username: data.username }
          : { kind: 'unavailable', message: data.message ?? 'That username is not available.' },
      );
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [candidate, minLength, currentUsername]);

  return status;
}

/** The outcome of a claim, in the shape the picker renders. */
export interface ClaimOutcome {
  ok: boolean;
  /** Present on failure. Safe to display. */
  message?: string;
  /** Present on failure. `USERNAME_CHANGE_TOO_SOON` carries `availableAt`. */
  code?: string;
  availableAt?: string;
}

/**
 * Claim a username, and dismiss the picker.
 *
 * Both invalidate the onboarding query on success, so the gate re-evaluates
 * against the server's answer rather than against an optimistic local guess.
 *
 * @returns `claim`, `skip`, and the in-flight flag both share.
 */
export function useUsernameActions() {
  const { refresh } = useOnboardingState();
  const [isSubmitting, setSubmitting] = useState(false);

  const claim = useCallback(
    async (username: string): Promise<ClaimOutcome> => {
      setSubmitting(true);
      try {
        const { data, error } = await apiPut<{
          profile: { username: string };
          unchanged: boolean;
        }>('/api/users/me/username', { username });

        if (error) {
          return { ok: false, message: error.message };
        }
        if (!data) {
          return { ok: false, message: 'Could not save that username. Try again.' };
        }

        await refresh();
        return { ok: true };
      } finally {
        setSubmitting(false);
      }
    },
    [refresh],
  );

  const skip = useCallback(async (): Promise<ClaimOutcome> => {
    setSubmitting(true);
    try {
      const { error } = await apiPost<{ skipped: boolean }>('/api/users/me/onboarding/skip');
      if (error) {
        return { ok: false, message: error.message };
      }
      await refresh();
      return { ok: true };
    } finally {
      setSubmitting(false);
    }
  }, [refresh]);

  return { claim, skip, isSubmitting };
}
