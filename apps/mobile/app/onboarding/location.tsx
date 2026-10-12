import { useRouter } from 'expo-router';
import { OnboardingLocationScreen } from '@/components/screens/OnboardingLocationScreen';
import { saveOnboardingData } from '@/lib/onboarding';
import { api } from '@/lib/client';

export default function OnboardingLocationRoute() {
  const router = useRouter();
  return (
    <OnboardingLocationScreen
      onContinue={(loc) => {
        void (async () => {
          await saveOnboardingData(loc);
          // Location is enrichment: the profile field is clearable and the
          // screen offers a skip, so a failed save never blocks the journey.
          const parts = [loc.city.trim(), loc.region.trim(), loc.country.trim()].filter(Boolean);
          if (parts.length > 0) {
            const { error } = await api.users.updateProfile({ location: parts.join(', ') });
            if (error) {
              console.warn('Location save failed', error.message);
            }
          }
          router.push('/onboarding/permissions');
        })();
      }}
      onSkip={() => router.push('/onboarding/permissions')}
    />
  );
}
