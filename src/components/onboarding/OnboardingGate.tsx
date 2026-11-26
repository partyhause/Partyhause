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
 * ERROR HANDLING
 *   On error, we show a retry button rather than failing open. A flaky network
 *   must not silently bypass the username picker. The user can retry or the
 *   error will clear on the next successful load.
 *   */
import { useState, type ReactNode } from 'react';
import { Loading } from '@/components/ui/loading';
import { useOnboardingState } from '@/hooks/use-onboarding';
import { UsernamePicker } from '@/components/onboarding/UsernamePicker';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface OnboardingGateProps {
  children: ReactNode;
}

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { state, isLoading, error, refresh } = useOnboardingState();
  const [justClaimed, setJustClaimed] = useState(false);

  // First load. A brief spinner here is the same one every other authenticated
  // surface already shows, so the transition does not read as a new screen.
  if (isLoading) {
    return <Loading fullScreen size="lg" />;
  }

  // Error state: show retry instead of failing open. A flaky network must not
  // silently bypass the username picker.
  if (error) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-12">
        <div className="text-center space-y-4 max-w-md">
          <p className="text-lg font-medium text-foreground">Unable to load onboarding status</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            onClick={() => refresh()}
            className="w-fit mx-auto"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Fail open only for truly missing state (not errors) or when picker not needed
  if (!state || !state.show_picker || justClaimed) {
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
