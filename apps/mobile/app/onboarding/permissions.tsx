import { useRouter } from 'expo-router';
import { OnboardingPermissionsPrimerScreen } from '@/components/screens/OnboardingPermissionsPrimerScreen';

export default function OnboardingPermissionsRoute() {
  const router = useRouter();
  return (
    <OnboardingPermissionsPrimerScreen
      onContinue={() => router.push('/onboarding/profile')}
    />
  );
}
