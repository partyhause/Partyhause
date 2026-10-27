import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { OnboardingFreeTrialPaymentScreen } from '@/components/screens/OnboardingFreeTrialPaymentScreen';
import { api } from '@/lib/client';

export default function OnboardingPaymentRoute() {
  const router = useRouter();

  // "Start free trial" hits POST /api/billing/trial/start — the real, once-
  // per-account trial. The server flips entitlement, which is what the flow
  // derivation reads (`paywall: entitlement.is_entitled`), so the wall clears
  // in the database before the dashboard ever renders. A repeat call while
  // the trial runs answers already_running (not an error); a used-up trial
  // answers 409 and the user proceeds anyway — they have already paid their
  // once, the flow just needs the entitlement they hold.
  const handleActivate = () => {
    void (async () => {
      const { error, data } = await api.billing.startTrial();
      if (error) {
        // TRIAL_ALREADY_USED / ALREADY_SUBSCRIBED: the account holds or held
        // entitlement, which clears the wall identically. Only a genuine
        // failure (network, 500) blocks.
        if (data === null && error.message && !/ALREADY/i.test(error.message)) {
          Alert.alert('Could not start trial', error.message);
          return;
        }
      }
      // Persist the funnel completion marker server-side: completed_at is
      // one-way, set the first time the final screen submits.
      await api.onboarding.save({ completed: true });
      router.replace('/');
    })();
  };

  return <OnboardingFreeTrialPaymentScreen onActivate={handleActivate} />;
}
