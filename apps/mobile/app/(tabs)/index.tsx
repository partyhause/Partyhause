import { useCallback, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import type { OnboardingState } from "@partyhause/core";
import { api } from "@/lib/client";
import { LandingScreen } from "@/components/screens/LandingScreenEnhanced";
import { AuthScreen } from "@/components/screens/AuthScreen";
import { DashboardScreen } from "@/components/screens/DashboardScreen";
import { UsernamePicker } from "@/components/UsernamePicker";

type AppMode = "loading" | "landing" | "auth" | "onboarding" | "dashboard";

export default function HomeScreen() {
  const [appMode, setAppMode] = useState<AppMode>("loading");
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);

  /**
   * Establish whether a usable session exists.
   *
   * A stored token is necessary but not sufficient: it can be expired or
   * revoked server-side. Trusting local state alone would land the user on a
   * dashboard whose every query then fails with 401. So the token is validated
   * against /api/auth/me, and a rejection is treated as signed out. The
   * transport clears the stored credentials on 401, so no stale token lingers.
   */
  const checkAuth = useCallback(async () => {
    if (!(await api.auth.isAuthenticated())) {
      setAppMode("landing");
      return;
    }

    const { data, error } = await api.auth.me();
    if (error || !data) {
      setUserId(null);
      setUserEmail(null);
      setAppMode("landing");
      return;
    }

    setUserId(data.id);
    setUserEmail(data.email);

    // Username gate. `show_picker` is computed server-side from four columns
    // precisely so this client and the web client cannot derive it differently;
    // the only job here is to render it.
    //
    // Failing open on error: an unreachable status endpoint must not become an
    // account lockout over a username prompt. The gate asks again next focus.
    const onboardingResult = await api.users.onboardingState();
    if (!onboardingResult.error && onboardingResult.data?.show_picker) {
      setOnboarding(onboardingResult.data);
      setAppMode("onboarding");
      return;
    }

    setOnboarding(null);
    setAppMode("dashboard");
  }, []);

  // On focus rather than on mount. This screen stays mounted while other
  // routes are pushed over it, so a mount-only check could not observe a
  // session ending elsewhere. Account deletion in /settings does exactly that:
  // it destroys the account and clears the token, then returns here. Without a
  // focus check the dashboard would still be rendered for a user who no longer
  // exists, and every query on it would fail with 401.
  useFocusEffect(
    useCallback(() => {
      void checkAuth();
    }, [checkAuth]),
  );

  const handleSignOut = async () => {
    // Clears the local session even if the network call fails, so a user can
    // always sign out while offline.
    await api.auth.signOut();
    setUserId(null);
    setUserEmail(null);
    setAppMode("landing");
  };

  if (appMode === "loading") {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.periwinkle[400]} />
      </View>
    );
  }

  if (appMode === "landing") {
    return (
      <LandingScreen
        onGetStarted={() => setAppMode("auth")}
      />
    );
  }

  if (appMode === "auth") {
    return (
      <AuthScreen
        onBackToLanding={() => setAppMode("landing")}
        // Re-running checkAuth rather than setting the mode directly: the
        // dashboard renders `userId!`, and the previous handler switched mode
        // without ever populating userId or userEmail, so it would have passed
        // null into a non-null assertion.
        onAuthSuccess={() => { void checkAuth(); }}
      />
    );
  }

  if (appMode === "onboarding" && onboarding) {
    return (
      <View style={styles.onboardingContainer}>
        <UsernamePicker
          state={onboarding}
          heading="Pick your username"
          description={
            onboarding.skippable
              ? "This is how people find you and tag you across PartyHause. You can set it later from Settings if you would rather not now."
              : "This is how people find you and tag you across PartyHause. Choose one to continue."
          }
          submitLabel="Continue"
          // The control exists only when the server says this account may
          // dismiss, which is true exactly for accounts predating the picker.
          onSkip={onboarding.skippable ? () => { void checkAuth(); } : undefined}
          onDone={() => { void checkAuth(); }}
        />
      </View>
    );
  }

  return (
    <DashboardScreen
      userId={userId!}
      userEmail={userEmail ?? "User"}
      onSignOut={handleSignOut}
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.neutral[950],
  },
  // Paper rather than the dark shell the dashboard uses: the picker is a form,
  // and its inputs and hairlines are specified against a light surface in
  // docs/BRAND.md.
  onboardingContainer: {
    flex: 1,
    backgroundColor: "#FBFAF9",
  },
});

import { COLORS } from '@/constants/theme';