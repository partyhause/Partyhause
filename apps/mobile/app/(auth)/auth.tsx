import { useLocalSearchParams, useRouter } from 'expo-router';
import { AuthScreen } from '@/components/screens/AuthScreen';

export default function AuthRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string }>();
  const intent = (params.intent as 'create_event' | 'join_event' | 'explore_features') || 'explore_features';

  return (
    <AuthScreen
      onBackToLanding={() => router.replace('/(auth)/landing')}
      onAuthSuccess={() => router.replace('/(tabs)')}
      intent={intent}
    />
  );
}
