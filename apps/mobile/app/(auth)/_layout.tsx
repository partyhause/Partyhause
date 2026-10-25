import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { api } from '@/lib/client';
import { COLORS } from '@/constants/theme';

export default function AuthLayout() {
  const router = useRouter();
  useEffect(() => {
    void (async () => {
      if (await api.auth.isAuthenticated()) {
        router.replace('/(tabs)');
      }
    })();
  }, [router]);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.cream[50] } }}>
      <Stack.Screen name="landing" />
      <Stack.Screen name="auth" />
    </Stack>
  );
}
