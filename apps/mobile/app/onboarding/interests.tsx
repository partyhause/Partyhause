import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { OnboardingInterestsScreen } from '@/components/screens/OnboardingInterestsScreen';
import { api } from '@/lib/client';

export default function OnboardingInterestsRoute() {
  const router = useRouter();

  // Interests are a real profile column the recommendations read
  // (user_profiles.interests, migration 20261008010000). PATCHing them here
  // rather than holding them until the end means a user who leaves after this
  // screen still has told us something. The screen offers a skip, so a failed
  // save alerts but does not block the journey — the same enrichment contract
  // the location screen follows.
  const handleContinue = (interests: string[]) => {
    void (async () => {
      const { error } = await api.users.updateProfile({ interests });
      if (error) {
        Alert.alert('Could not save interests', error.message);
      }
      router.push('/onboarding/location');
    })();
  };

  return (
    <OnboardingInterestsScreen
      onContinue={handleContinue}
      onSkip={() => router.push('/onboarding/location')}
    />
  );
}
