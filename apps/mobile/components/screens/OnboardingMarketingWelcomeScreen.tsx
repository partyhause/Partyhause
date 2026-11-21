import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';

export interface OnboardingMarketingWelcomeScreenProps {
  onContinue: () => void;
}

export const OnboardingMarketingWelcomeScreen: React.FC<OnboardingMarketingWelcomeScreenProps> = ({ onContinue }) => {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.illustration}>
          {/* Decorative party shapes */}
        </View>
        <Text style={styles.title}>Welcome to PartyHause</Text>
        <Text style={styles.subtitle}>Create events, invite friends, and keep the memories alive.</Text>
        <TouchableOpacity style={styles.button} onPress={onContinue}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.cream[50] },
  content: { flex: 1, padding: SPACING.xxl, justifyContent: 'center' },
  illustration: { height: 120, marginBottom: SPACING.xxl, borderRadius: 32, backgroundColor: COLORS.teal[100], opacity: 0.6 },
  title: { fontSize: TYPOGRAPHY.h1.fontSize, fontWeight: TYPOGRAPHY.h1.fontWeight as any, color: COLORS.neutral[900], marginBottom: SPACING.md, textAlign: 'center' },
  subtitle: { fontSize: TYPOGRAPHY.body.fontSize, color: COLORS.text.secondary, marginBottom: SPACING.xxxl, textAlign: 'center' },
  button: { height: 56, backgroundColor: COLORS.teal[700], borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: TYPOGRAPHY.body.fontSize, fontWeight: TYPOGRAPHY.bodyBold.fontWeight as any },
});
