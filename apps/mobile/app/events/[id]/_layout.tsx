import { Stack } from 'expo-router';
import { COLORS } from '@/constants/theme';

export default function EventIdLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false, // Let individual screens handle their own headers
        contentStyle: { backgroundColor: COLORS.background.secondary },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Event Details',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="guests"
        options={{
          title: 'Guest List',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="activities"
        options={{
          title: 'Activities',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="invites"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}
