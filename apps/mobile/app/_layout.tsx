// global.css is the NativeWind stylesheet: the Tailwind directives compiled by
// withNativeWind in metro.config.js. It must be imported once, here, at the
// root, before any component renders.
import '../global.css';
import 'react-native-url-polyfill/auto';
// Themes come from expo-router, not @react-navigation/native. SDK 57 vendors
// its own copy of React Navigation and marks the standalone re-exports
// deprecated: "Import `DarkTheme` from `expo-router` instead. Will be removed
// in a future SDK." Importing both pulls two copies of the navigation types
// into the graph, which is where the tab-bar prop mismatch came from.
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useEffect } from "react";
import { Platform } from "react-native";

import { AppProviders } from "../providers/AppProviders";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { COLORS } from "@/constants/theme";

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Register service worker for PWA on web
  useEffect(() => {
    if (Platform.OS !== 'web' || !('serviceWorker' in navigator)) {
      return;
    }

    const registerServiceWorker = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
    };

    if (document.readyState === 'complete') {
      registerServiceWorker();
      return;
    }

    window.addEventListener('load', registerServiceWorker, { once: true });
    return () => window.removeEventListener('load', registerServiceWorker);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.cream[50] }}>
      <AppProviders>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ contentStyle: { backgroundColor: COLORS.cream[50] } }}>
            {/* title is the fallback iOS uses for the back-button label on
                screens pushed above the tabs. Without it the previous route
                has no title and the header renders the literal group name
                "(tabs)". */}
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
            <Stack.Screen name="events" options={{ headerShown: false, title: 'Events' }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </AppProviders>
    </GestureHandlerRootView>
  );
}
