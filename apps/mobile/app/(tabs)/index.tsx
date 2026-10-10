import { useCallback, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import type { OnboardingState } from "@partyhause/core";
import { api } from "@/lib/client";
import { AuthScreen } from "@/components/screens/AuthScreen";
import { DashboardScreen } from "@/components/screens/DashboardScreen";
import { UsernamePicker } from "@/components/UsernamePicker";
import { LandingScreen } from "@/components/screens/LandingScreen";
import { OnboardingMarketingFlow } from "@/components/screens/OnboardingMarketingFlow";

type AppMode = "landing" | "loading" | "auth" | "username_picker" | "onboarding_marketing" | "dashboard";

export default function HomeScreen() {
  const [appMode, setAppMode] = useState<AppMode>("landing");
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
      setAppMode("auth");
      return;
    }

    const { data, error } = await api.auth.me();
    if (error || !data) {
      setUserId(null);
      setUserEmail(null);
      setAppMode("auth");
      return;
    }

    setUserId(data.id);
    setUserEmail(data.email);

    // Username picker gate - part of onboarding journey
    const onboardingResult = await api.users.onboardingState();
    if (!onboardingResult.error && onboardingResult.data?.show_picker) {
      setOnboarding(onboardingResult.data);
      setAppMode("username_picker");
      return;
    }

    setOnboarding(null);
    
    // Check if user has completed marketing onboarding
    // For now, assume new users need onboarding. In production, check server flag
    // like data.profile.onboarding_completed
    const hasCompletedOnboarding = data.profile?.onboarding_completed ?? false;
    
    if (!hasCompletedOnboarding) {
      setAppMode("onboarding_marketing");
      return;
    }

    setAppMode("dashboard");
  }, []);

  // Auth check is no longer automatic on focus. The app always starts on
  // the landing page and only transitions to auth/dashboard when the user
  // explicitly requests it. This satisfies the requirement to always start from
  // landing and removes the forced auth screen on launch.
  // useFocusEffect(
  //   useCallback(() => {
  //     void checkAuth();
  //   }, [checkAuth]),
  // );

  const handleSignOut = async () => {
    // Clears the local session even if the network call fails, so a user can
    // always sign out while offline.
    await api.auth.signOut();
    setUserId(null);
    setUserEmail(null);
    setAppMode("landing");
  };

  if (appMode === "landing") {
    return (
      <LandingScreen
        onGetStarted={() => { setAppMode("loading"); void checkAuth(); }}
        onSignIn={() => { setAppMode("auth"); }}
      />
    );
  }

  if (appMode === "loading") {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.periwinkle[400]} />
      </View>
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

  if (appMode === "username_picker" && onboarding) {
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
          onSkip={onboarding.skippable ? () => { void checkAuth(); } : undefined}
          onDone={() => { void checkAuth(); }}
        />
      </View>
    );
  }

  if (appMode === "onboarding_marketing") {
    return <OnboardingMarketingFlow onComplete={() => { void checkAuth(); }} />;
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
    backgroundColor: COLORS.cream[100],
  },
  // Paper rather than the dark shell the dashboard uses: the picker is a form,
  // and its inputs and hairlines are specified against a light surface in
  // docs/BRAND.md.
  onboardingContainer: {
    flex: 1,
    backgroundColor: "COLORS.cream.50",
  },
});

import { COLORS } from '@/constants/theme';