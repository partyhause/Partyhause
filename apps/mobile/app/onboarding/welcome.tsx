import { useRouter } from 'expo-router';
import { OnboardingMarketingWelcomeScreen } from '@/components/screens/OnboardingMarketingWelcomeScreen';

export default function OnboardingWelcomeRoute() {
  const router = useRouter();
  return (
    <OnboardingMarketingWelcomeScreen
      onContinue={() => router.push('/onboarding/role')}
    />
  );
}
