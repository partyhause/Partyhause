import { Stack } from 'expo-router';
import { COLORS } from '@/constants/theme';

export default function InvitesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false, // Custom headers in each screen
        contentStyle: { backgroundColor: COLORS.background.secondary },
      }}
    >
      <Stack.Screen
        name="templates"
        options={{
          title: 'Invite Templates',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="create"
        options={{
          title: 'Customize Invite',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="send"
        options={{
          title: 'Send Invitations',
          headerShown: false,
        }}
      />
    </Stack>
  );
}
