import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { OnboardingProfileCompletionScreen } from '@/components/screens/OnboardingProfileCompletionScreen';
import { api } from '@/lib/client';

export default function OnboardingProfileRoute() {
  const router = useRouter();

  // Identity fields persist to the real API before the journey continues: a
  // display name the server never stored would be lost on the next login,
  // and the username claim runs through availability first because the
  // endpoint refuses taken handles with 409 (USERNAME_TAKEN).
  const handleDone = (input: { displayName: string; username: string; marketingOptIn: boolean }) => {
    void (async () => {
      const displayName = input.displayName.trim();
      const handle = input.username.trim().replace(/^@/, '');

      if (displayName.length === 0) {
        Alert.alert('Display name required', 'Add the name friends will see on your invites.');
        return;
      }

      const state = await api.users.onboardingState();
      console.log('[onboarding/profile] onboardingState', state);
      const currentUsername = state.data?.username ?? '';
      const normalize = (s: string) => s.toLowerCase().trim();
      if (handle.length > 0 && normalize(handle) !== normalize(currentUsername)) {
        const availability = await api.users.checkUsername(handle);
        console.log('[onboarding/profile] checkUsername result', availability);
        if (availability.data && !availability.data.available) {
          Alert.alert('Username taken', availability.data.message ?? '@' + handle + ' is not available. Try another.');
          return;
        }
        const claimed = await api.users.setUsername(handle);
        console.log('[onboarding/profile] setUsername result', claimed);
        if (claimed.error) {
          Alert.alert('Username unavailable', claimed.error.message);
          return;
        }
      }

      const { error } = await api.users.updateProfile({
        display_name: displayName,
        marketing_opt_in: input.marketingOptIn,
      });
      if (error) {
        Alert.alert('Could not save profile', error.message);
        return;
      }

      router.push('/onboarding/payment');
    })();
  };

  return <OnboardingProfileCompletionScreen onDone={handleDone} />;
}
