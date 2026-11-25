/**
 * `/onboarding/profile` — the mobile journey's profile-completion screen, on
 * the web.
 *
 * IDENTITY BEFORE BILLING
 *   The mobile journey closes with profile then payment, in that order, and
 *   the union funnel keeps it: a display name the server never stored would
 *   be lost on the next login, and the paywall's post-trial dashboard renders
 *   that name. The username claim runs through availability first because
 *   the endpoint refuses taken handles with 409 (USERNAME_TAKEN).
 *
 * THE SERVER VALIDATES; THIS SCREEN DISPLAYS
 *   Mobile had no inline validation either — every rule lives in the route
 *   handler and renders as an alert. The web keeps the server as the single
 *   validator (the same handle rules the Settings picker enforces: 3–30
 *   chars, letters/numbers/underscores, 30-day change cooldown) but shows
 *   the failures inline, next to the field that caused them, which is the
 *   one part of mobile's alert() UX worth not porting.
 *
 * AN EMPTY HANDLE IS ALLOWED
 *   Same as mobile: an unchanged or empty username skips the claim entirely.
 *   The username gate upstream (OnboardingGate) has usually already settled
 *   the handle; this field is for the user who skipped that gate.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api-client';
import {
  useFunnelState,
  useFunnelSave,
} from '@/features/onboarding/useOnboardingJourney';
import { ONBOARDING_ROUTE } from '@/features/onboarding/journeyRoutes';
import { usePartyStore } from '@/store/usePartyStore';

/** docs/BRAND.md section 4.1: coral-700 passes AA for text, the 500 does not. */
const CORAL_700 = '#C02A16';

export function ProfileStep() {
  const { state } = useFunnelState();
  const { save } = useFunnelSave();
  const navigate = useNavigate();
  const storeUser = usePartyStore((s) => s.user);

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(
    state?.answers.marketing_opt_in ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDone = () => {
    if (saving) return;
    void (async () => {
      const name = displayName.trim();
      const handle = username.trim().replace(/^@/, '');

      if (name.length === 0) {
        setError('Add the name friends will see on your invites.');
        return;
      }

      setSaving(true);
      setError(null);
      try {
        // Claim only when the handle is new. The server 409s a taken one;
        // its message names the cooldown when USERNAME_CHANGE_TOO_SOON.
        if (handle.length > 0) {
          const { data: stateData } = await apiGet<{
            username: string;
          }>('/api/users/me/onboarding');
          const currentUsername = stateData?.username ?? '';
          if (handle !== currentUsername) {
            const claimed = await apiPut('/api/users/me/username', { username: handle });
            if (claimed.error) {
              setError(claimed.error.message ?? '@' + handle + ' is not available. Try another.');
              return;
            }
          }
        }

        const { error: profileError } = await apiPut('/api/users/me/profile', {
          display_name: name,
        });
        if (profileError) {
          setError(profileError.message ?? 'Could not save your profile. Try again.');
          return;
        }

        // The opt-in and the marketing consent marker are funnel answers.
        // A failed save here warns and continues: identity is already
        // stored, and the consent flag is re-askable from settings.
        const outcome = await save({ marketing_opt_in: marketingOptIn });
        if (!outcome.ok) {
          setError(outcome.message ?? 'Could not save your preferences. Continuing anyway.');
        }

        // The store's cached user name feeds the dashboard header; refresh
        // it so the name this screen just wrote is what the header shows
        // without a reload.
        if (storeUser) {
          usePartyStore.getState().setUser({ ...storeUser, name });
        }

        navigate(ONBOARDING_ROUTE.payment);
      } finally {
        setSaving(false);
      }
    })();
  };

  const skipAhead = () => {
    if (saving) return;
    navigate(ONBOARDING_ROUTE.payment);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-3xl font-bold text-foreground">Finish your profile</h1>
        <p className="mt-2 text-base text-muted-foreground">
          The name and handle your invites carry.
        </p>

        <div className="mt-8 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Display name
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={storeUser?.name || 'Display name'}
              maxLength={80}
              className="h-11 w-full rounded-lg border border-input bg-card px-4 text-foreground placeholder:text-muted-foreground focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Username
            </span>
            <div className="flex h-11 items-center rounded-lg border border-input bg-card px-4 focus-within:border-orange-300 focus-within:ring-2 focus-within:ring-orange-100">
              <span className="mr-1 text-muted-foreground">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your handle"
                maxLength={30}
                className="h-full w-full bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <span className="mt-1.5 block text-xs text-muted-foreground">
              Letters, numbers and underscores. 3 to 30 characters. You can
              change it again after 30 days.
            </span>
          </label>

          <label className="flex items-center justify-between rounded-xl border border-input bg-card p-4">
            <span className="text-sm font-medium text-foreground">
              Get tips and event inspiration
            </span>
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
              className="h-5 w-5 accent-orange-600"
            />
          </label>
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-sm" style={{ color: CORAL_700 }}>
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleDone}
          disabled={saving}
          className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: CORAL_700 }}
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : 'Continue'}
        </button>
        <button
          type="button"
          onClick={skipAhead}
          disabled={saving}
          className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg text-base font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
