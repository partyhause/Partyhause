import { Stack } from 'expo-router';

/**
 * Profile stack.
 *
 * The root `<Stack.Screen name="(tabs)">` hides its header and previously
 * carried no title, so a profile screen pushed on top of a tab resolved its
 * iOS back-button label from the previous route and rendered the literal
 * group name "(tabs)". An explicit headerBackTitle here (plus the root
 * title fallback) removes that path on home/profile and any future
 * profile-adjacent route.
 */
export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="[id]" options={{ title: 'Profile' }} />
    </Stack>
  );
}
