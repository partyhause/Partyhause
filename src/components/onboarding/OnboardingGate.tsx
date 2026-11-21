/**
 * Stands between a signed-in user and the app until their handle is settled.
 *
 * WHERE IT SITS, AND WHY THERE
 *   Inside `ProtectedRoute`, so every authenticated surface is covered by
 *   construction rather than by remembering to wrap each one. `src/App.tsx`
 *   reaches its pages through two separate mechanisms, a React Router table and
 *   a `currentPage` string switch, and a gate wired into only one of them would
 *   be trivially walked around by using the other.
 *
 * WHAT IT DOES NOT DO
 *   It never decides for itself whether to show. `show_picker` is computed by
 *   the server from four columns, and this component renders it. Two clients
 *   deriving the same boolean from the same four fields is two chances to
 *   derive it differently, and the failure modes are a user nagged forever or
 *   one never asked at all.
 *
 * FAILING OPEN
 *   If the status request fails, the children render. A username picker is not
 *   worth locking somebody out of their account over, and the gate will ask
 *   again on the next load. The one thing it must not do is show a blank screen
 *   while a request retries.
 */

import { useState, type ReactNode } from 'react';
import { Loading } from '@/components/ui/loading';
import { useOnboardingState } from '@/hooks/use-onboarding';
import { UsernamePicker } from '@/components/onboarding/UsernamePicker';

interface OnboardingGateProps {
  children: ReactNode;
}

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { state, isLoading, error } = useOnboardingState();
  const [justClaimed, setJustClaimed] = useState(false);

  // First load. A brief spinner here is the same one every other authenticated
  // surface already shows, so the transition does not read as a new screen.
  if (isLoading) {
    return <Loading fullScreen size="lg" />;
  }

  // Fail open. See the header: an unreachable status endpoint must not become
  // an account lockout.
  if (error || !state || !state.show_picker || justClaimed) {
    return <>{children}</>;
  }
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-12">
      <UsernamePicker
        state={state}
        heading="Pick your username"
        description={
          state.skippable
            ? 'This is how people find you and tag you across PartyHause. You can set it later from Settings if you would rather not now.'
            : 'This is how people find you and tag you across PartyHause. Choose one to continue.'
        }
        submitLabel="Continue"
        onSkip={state.skippable ? () => undefined : undefined}
        onDone={() => setJustClaimed(true)}
      />
    </div>
  );
}
