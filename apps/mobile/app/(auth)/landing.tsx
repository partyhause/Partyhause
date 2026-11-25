import { useRouter } from 'expo-router';
import { LandingScreen } from '@/components/screens/LandingScreen';

export default function LandingRoute() {
  const router = useRouter();
  return (
    <LandingScreen
      onGetStarted={(intent) => router.replace(`/(auth)/auth?intent=${intent}`)}
      onSignIn={(intent) => router.replace(`/(auth)/auth?intent=${intent}`)}
    />
  );
}
