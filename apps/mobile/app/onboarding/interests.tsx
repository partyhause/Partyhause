import { useRouter } from 'expo-router';
import { OnboardingInterestsScreen } from '@/components/screens/OnboardingInterestsScreen';
import { saveOnboardingData } from '@/lib/onboarding';

export default function OnboardingInterestsRoute() {
  const router = useRouter();
  return (
    <OnboardingInterestsScreen
      onContinue={(interests) => {
        void saveOnboardingData({ interests });
        router.push('/onboarding/location');
      }}
      onSkip={() => router.push('/onboarding/location')}
    />
  );
}
