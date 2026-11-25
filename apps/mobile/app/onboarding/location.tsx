import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { OnboardingLocationScreen } from '@/components/screens/OnboardingLocationScreen';
import { api } from '@/lib/client';

export default function OnboardingLocationRoute() {
  const router = useRouter();
  return (
    <OnboardingLocationScreen
      onContinue={(loc) => {
        void (async () => {
          // Location is enrichment: the profile field is clearable and the
          // screen offers a skip, so a failed save alerts but never blocks
          // the journey.
          const parts = [loc.city.trim(), loc.region.trim(), loc.country.trim()].filter(Boolean);
          if (parts.length > 0) {
            const { error } = await api.users.updateProfile({ location: parts.join(', ') });
            if (error) {
              Alert.alert('Location save failed', error.message);
            }
          }
          router.push('/onboarding/permissions');
        })();
      }}
      onSkip={() => router.push('/onboarding/permissions')}
    />
  );
}
