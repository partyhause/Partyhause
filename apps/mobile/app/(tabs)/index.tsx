import { useCallback, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Redirect, useFocusEffect } from "expo-router";
import type { OnboardingState } from "@partyhause/core";
import { api } from "@/lib/client";
import { fetchOnboardingGate } from "@/lib/onboarding";
import { AuthScreen } from "@/components/screens/AuthScreen";
import { DashboardScreen } from "@/components/screens/DashboardScreen";
import { UsernamePicker } from "@/components/UsernamePicker";
import { LandingScreen } from "@/components/screens/LandingScreen";

type AppMode = "landing" | "loading" | "auth" | "username_picker" | "dashboard";

export default function HomeScreen() {
  const [appMode, setAppMode] = useState<AppMode>("loading");
  const [authIntent, setAuthIntent] = useState<'create_event' | 'join_event' | 'explore_features' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

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

    // The database decides, not local state. GET /api/onboarding returns
    // flow.completed derived from the stored answers and the caller's
    // entitlement; honoring a local AsyncStorage flag here instead meant a
    // finished user was bounced back into the flow on every login, or an
    // unfinished one admitted to the dashboard. A failed call falls through
    // to the dashboard rather than gating: the /onboarding layout guard
    // re-checks on mount, so a flaky network cannot strand anyone.
    const gate = await fetchOnboardingGate();
    if (gate) {
      setNeedsOnboarding(!gate.completed);
    }
    setAppMode("dashboard");
  }, []);

  // The gate below renders a redirect into /onboarding whenever the stored
  // completion flag is missing, so checkAuth runs on every focus: it is what
  // flips the flag state after the final onboarding step writes it and pops
  // back here.
  useFocusEffect(
    useCallback(() => {
      void checkAuth();
    }, [checkAuth]),
  );

  const handleSignOut = async () => {
    void (async () => {
      await api.auth.signOut();
    })();
    setAppMode("auth");
  };


  if (appMode === "loading") {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.periwinkle[400]} />
      </View>
    );
  }

  if (appMode === "auth") {
    return <Redirect href="/(auth)/landing" />;
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

  // Unfinished onboarding routes into the /onboarding group, where each step
  // is a real expo-router route with its own URL. checkAuth on focus (above)
  // is what lands the user back on the dashboard once the final step writes
  // the completion flag and replaces home.
  if (needsOnboarding && appMode === "dashboard") {
    return <Redirect href="/onboarding/welcome" />;
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