import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { api } from '@/lib/client';
import { fetchOnboardingGate } from '@/lib/onboarding';
import { COLORS } from '@/constants/theme';

export default function OnboardingLayout() {
  const router = useRouter();

  // Guard: only an authenticated user with unfinished onboarding belongs in
  // this group, and the database decides — not a local flag. A completed user
  // is bounced home, where the focus checkAuth lands them on the dashboard;
  // an unauthenticated one is bounced to the landing/auth gate. Without this,
  // deep-linking /onboarding after completing the flow would replay it from
  // the top. A failed gate call keeps the user here: the step routes save
  // per screen, so re-rendering the current step is safe.
  useEffect(() => {
    void (async () => {
      if (!(await api.auth.isAuthenticated())) {
        router.replace('/');
        return;
      }
      const gate = await fetchOnboardingGate();
      if (gate?.completed) {
        router.replace('/');
      }
    })();
  }, [router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.cream[50] } }} />
  );
}
