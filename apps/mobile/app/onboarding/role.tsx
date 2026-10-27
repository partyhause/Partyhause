import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { OnboardingRoleSelectionScreen } from '@/components/screens/OnboardingRoleSelectionScreen';
import { api } from '@/lib/client';

export default function OnboardingRoleRoute() {
  const router = useRouter();

  // organizer_type is a database column the server derives step completion
  // from (`who_you_are: answers.organizer_type !== null`), so the choice is
  // PATCHed per screen rather than held until the end. A failed save stops
  // the journey: continuing would leave the server asking the same question
  // again on the next login.
  const handleContinue = (role: string) => {
    void (async () => {
      const { error } = await api.onboarding.save({ organizer_type: role as 'personal' | 'professional' | 'corporate' | 'community' });
      if (error) {
        Alert.alert('Could not save', error.message);
        return;
      }
      router.push('/onboarding/interests');
    })();
  };

  return (
    <OnboardingRoleSelectionScreen
      onContinue={handleContinue}
      onSkip={() => router.push('/onboarding/interests')}
    />
  );
}
