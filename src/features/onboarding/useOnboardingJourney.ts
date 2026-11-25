/**
 * The five-screen onboarding journey, for the web client.
 *
 * MIRRORS apps/mobile/lib/onboarding.ts AND packages/core/src/resources/onboarding.ts
 *   The web app runs its own HTTP client (src/lib/api-client.ts) and therefore
 *   its own resource layer for the funnel, the same way it already does for
 *   events, guests and the username picker (src/hooks/use-onboarding.ts).
 *   Until the two clients are unified, every endpoint here is a two-site
 *   change with packages/core — the shapes below are transcribed from
 *   packages/core/src/resources/onboarding.ts, not invented.
 *
 * ONE FETCH PER SESSION, NOT ONE PER PAGE
 *   `staleTime: Infinity`, like the username picker's hook. The only things
 *   that change the answer are the PATCH this module owns, a trial start,
 *   and an AI turn (which moves `chat`), and each of those invalidates here.
 *
 * FAILING OPEN
 *   An unreachable /api/onboarding must never become a lockout. Callers treat
 *   `state === null` as "no journey information" and render their own surface;
 *   the journey is offered from the dashboard rather than hard-gating the
 *   app. That is a deliberate divergence from the mobile client, which
 *   hard-gates: the web chat step completes only from an LLM-sourced turn
 *   (server/lib/onboarding-flow.ts reads `ai.used`, and heuristic turns are
 *   never billable), so a hard gate would strand every user of an
 *   unconfigured-LLM deployment — including local dev — on screen one
 *   forever.
 */

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { usePartyStore } from '@/store/usePartyStore';

/** The step ids, as the server names them. Order lives in the server. */
export type FunnelStepId = 'chat' | 'who_you_are' | 'ai_lifecycle' | 'paywall' | 'autonomy';

export interface FunnelStepView {
  id: FunnelStepId;
  /** One-based, for display. */
  position: number;
  complete: boolean;
  locked: boolean;
}

export interface FunnelFlowView {
  schema_version: string;
  steps: FunnelStepView[];
  current_step: FunnelStepId | null;
  completed: boolean;
  blocked_by_paywall: boolean;
}

export interface FunnelEntitlement {
  plan: 'free' | 'creator' | 'vendor';
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
  is_entitled: boolean;
  can_use_ai: boolean;
  trial_ends_at: string | null;
  trial_days_remaining: number | null;
  paywall: {
    show: boolean;
    reason: 'free_quota_exhausted' | 'subscription_required' | 'subscription_lapsed' | null;
  };
  can_start: { card_14d: boolean };
  ai: { used: number; limit: number; remaining: number };
}

/** The stored answers, as GET /api/onboarding returns them. */
export interface FunnelAnswers {
  organizer_type: 'personal' | 'professional' | 'corporate' | 'community' | null;
  events_per_year: '1-2' | '3-10' | '11-50' | '50+' | null;
  typical_guest_count: 'under-20' | '20-50' | '51-150' | 'over-150' | null;
  ai_before: string[];
  ai_during: string[];
  ai_after: string[];
  autonomy_level: 'suggest' | 'draft' | 'act_with_approval' | 'act_autonomously' | null;
  agentic_wants: string[];
  biggest_pain: string | null;
  /** Event-type chips from the interests screen. */
  event_interests: string[];
  /** The "Get tips and event inspiration" switch. */
  marketing_opt_in: boolean;
  completed_at: string | null;
}

/** The answer to GET /api/onboarding: flow, answers and entitlement together. */
export interface FunnelState {
  flow: FunnelFlowView;
  answers: FunnelAnswers;
  entitlement: FunnelEntitlement;
}

/** A partial answer set, as PATCH /api/onboarding accepts. */
export type FunnelAnswerPatch = Partial<
  Pick<FunnelAnswers, 'organizer_type' | 'events_per_year' | 'typical_guest_count'>
> & {
  ai_before?: string[];
  ai_during?: string[];
  ai_after?: string[];
  autonomy_level?: FunnelAnswers['autonomy_level'];
  agentic_wants?: string[];
  biggest_pain?: string;
  event_interests?: string[];
  marketing_opt_in?: boolean;
  /** Set by the final screen. Absent means "saving progress". */
  completed?: boolean;
};

export const FUNNEL_QUERY_KEY = ['onboarding-funnel', 'me'] as const;

/**
 * Read the caller's journey state.
 *
 * @returns The state, its loading and error flags, and a `refresh` that
 *          forces a re-read. `state` is null until the first successful load
 *          and stays null on failure, which is what fail-open callers key on.
 */
export function useFunnelState() {
  const user = usePartyStore((s) => s.user);
  const queryClient = useQueryClient();

  const query = useQuery<FunnelState | null, Error>({
    queryKey: FUNNEL_QUERY_KEY,
    enabled: Boolean(user),
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await apiGet<FunnelState>('/api/onboarding');
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const refresh = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: FUNNEL_QUERY_KEY });
  }, [queryClient]);

  return {
    state: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
    refresh,
  };
}

/** The outcome of a save or a trial start, in the shape the screens render. */
export interface FunnelMutationOutcome {
  ok: boolean;
  /** The server's recomputed flow, when the call succeeded and returned one. */
  flow?: FunnelFlowView;
  /** Present on failure. Safe to display. */
  message?: string;
}

/**
 * Save answers, per screen.
 *
 * The server answers with the recomputed state, so the caller re-renders from
 * the server's answer rather than from an optimistic local guess — the same
 * contract the shared client documents for `api.onboarding.save`.
 *
 * `completed: true` is one-way server-side and marks the funnel finished.
 */
export function useFunnelSave() {
  const { refresh } = useFunnelState();
  const [isSaving, setSaving] = useState(false);

  const save = useCallback(
    async (patch: FunnelAnswerPatch): Promise<FunnelMutationOutcome> => {
      setSaving(true);
      try {
        const { data, error } = await apiPatch<FunnelState>('/api/onboarding', patch);
        if (error) return { ok: false, message: error.message };
        if (!data) return { ok: false, message: 'Could not save that answer. Try again.' };
        await refresh();
        return { ok: true, flow: data.flow };
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  return { save, isSaving };
}

/**
 * Start the once-per-account card trial from the plan screen.
 *
 * 409 is not a failure for the journey's purposes: TRIAL_ALREADY_USED and
 * ALREADY_SUBSCRIBED both mean the account holds or held entitlement, which
 * is what clears the wall in the flow derivation. The mobile payment route
 * treats them identically; a genuine failure (network, 500) is the only
 * blocker.
 */
export function useTrialStart() {
  const { refresh } = useFunnelState();
  const [isStarting, setStarting] = useState(false);

  const start = useCallback(async (): Promise<FunnelMutationOutcome> => {
    setStarting(true);
    try {
      const { error } = await apiPost<{
        trial_ends_at: string;
        already_running: boolean;
      }>('/api/billing/trial/start');

      if (error) {
        const already = /already|subscribed|trial/i.test(error.message ?? '');
        if (already) {
          await refresh();
          return { ok: true };
        }
        return { ok: false, message: error.message };
      }
      await refresh();
      return { ok: true };
    } finally {
      setStarting(false);
    }
  }, [refresh]);

  return { start, isStarting };
}
