import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';

export interface OnboardingPermissionsPrimerScreenProps {
  onContinue: () => void;
}

export const OnboardingPermissionsPrimerScreen: React.FC<OnboardingPermissionsPrimerScreenProps> = ({ onContinue }) => {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.illustration} />
        <Text style={styles.title}>Stay connected</Text>
        <Text style={styles.subtitle}>We’ll only access your contacts to make inviting easier. No data leaves your device without permission.</Text>
        <TouchableOpacity style={styles.button} onPress={onContinue}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background.secondary },
  content: { flex: 1, padding: SPACING.xxl, justifyContent: 'center' },
  illustration: { height: 120, borderRadius: 32, backgroundColor: COLORS.magenta.light, opacity: 0.6, marginBottom: SPACING.xxl },
  title: { fontSize: TYPOGRAPHY.h1.fontSize, fontWeight: '700' as any, color: COLORS.neutral[900], marginBottom: SPACING.md, textAlign: 'center' },
  subtitle: { fontSize: TYPOGRAPHY.body.fontSize, color: COLORS.text.secondary, marginBottom: SPACING.xxxl, textAlign: 'center' },
  button: { height: 56, backgroundColor: COLORS.teal[700], borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: TYPOGRAPHY.body.fontSize, fontWeight: '600' as any },
});
