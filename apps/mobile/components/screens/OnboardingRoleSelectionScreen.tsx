import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';

export interface OnboardingRoleSelectionScreenProps {
  onContinue: (role: string) => void;
  onSkip: () => void;
}

const roles = [
  { id: 'personal', label: 'I host events' },
  { id: 'professional', label: 'I’m a vendor' },
  { id: 'corporate', label: 'I host for a company' },
  { id: 'community', label: 'I’m exploring' },
];

export const OnboardingRoleSelectionScreen: React.FC<OnboardingRoleSelectionScreenProps> = ({ onContinue, onSkip }) => {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>What brings you here?</Text>
        <Text style={styles.subtitle}>Choose how you’ll use PartyHause.</Text>
        {roles.map(r => (
          <TouchableOpacity key={r.id} style={[styles.option, selected === r.id && styles.optionSelected]} onPress={() => setSelected(r.id)}>
            <Text style={[styles.optionText, selected === r.id && styles.optionTextSelected]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.skip} onPress={onSkip}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, !selected && styles.buttonDisabled]} disabled={!selected} onPress={() => selected && onContinue(selected)}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background.secondary },
  content: { padding: SPACING.xxl },
  title: { fontSize: TYPOGRAPHY.h1.fontSize, fontWeight: '700' as any, color: COLORS.neutral[900], marginBottom: SPACING.md },
  subtitle: { fontSize: TYPOGRAPHY.body.fontSize, color: COLORS.text.secondary, marginBottom: SPACING.xl },
  option: { backgroundColor: '#FFFFFF', padding: SPACING.lg, borderRadius: 24, marginBottom: SPACING.md, borderWidth: 2, borderColor: 'transparent' },
  optionSelected: { borderColor: COLORS.teal[700], backgroundColor: COLORS.teal[50] },
  optionText: { fontSize: TYPOGRAPHY.body.fontSize, color: COLORS.neutral[900] },
  optionTextSelected: { fontWeight: '600' as any },
  skip: { marginTop: SPACING.md, alignItems: 'center' },
  skipText: { color: COLORS.text.secondary },
  button: { height: 56, backgroundColor: COLORS.teal[700], borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginTop: SPACING.xl },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: TYPOGRAPHY.body.fontSize, fontWeight: '600' as any },
});
