import React, { useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OnboardingMarketingWelcomeScreen } from './OnboardingMarketingWelcomeScreen';
import { OnboardingRoleSelectionScreen } from './OnboardingRoleSelectionScreen';
import { OnboardingInterestsScreen } from './OnboardingInterestsScreen';
import { OnboardingLocationScreen } from './OnboardingLocationScreen';
import { OnboardingPermissionsPrimerScreen } from './OnboardingPermissionsPrimerScreen';
import { OnboardingProfileCompletionScreen } from './OnboardingProfileCompletionScreen';
import { OnboardingFreeTrialPaymentScreen } from './OnboardingFreeTrialPaymentScreen';


export const OnboardingMarketingFlow: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => {
  const [step, setStep] = useState<Step>(0);
  const [data, setData] = useState<any>({});

  const next = (partial: any) => {
    setData(d => ({ ...d, ...partial }));
    setStep(s => Math.min(6, (s + 1) as Step));
  };

  const skip = () => setStep(s => Math.min(6, (s + 1) as Step));

  switch (step) {
    case 0:
      return <OnboardingMarketingWelcomeScreen onContinue={() => setStep(1)} />;
    case 1:
      return <OnboardingRoleSelectionScreen onContinue={(role) => next({ role })} onSkip={skip} />;
    case 2:
      return <OnboardingInterestsScreen onContinue={(interests) => next({ interests })} onSkip={skip} />;
    case 3:
      return <OnboardingLocationScreen onContinue={(loc) => next({ location: loc })} onSkip={skip} />;
    case 4:
      return <OnboardingPermissionsPrimerScreen onContinue={() => setStep(5)} />;
    case 5:
      return <OnboardingProfileCompletionScreen onDone={(profile) => next({ profile })} />;
    case 6:
      return <OnboardingFreeTrialPaymentScreen onActivate={(plan) => { 
        const onboardingData = { ...data, plan, onboarding_completed: true };
        // Persist to AsyncStorage
        AsyncStorage.setItem('onboarding_data', JSON.stringify(onboardingData));
        AsyncStorage.setItem('onboarding_completed', 'true');
        console.log('Activate', onboardingData);
        onComplete?.(); 
      }} />;

      return null;
  }
};
