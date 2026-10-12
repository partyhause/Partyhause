import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';

const interests = ['Birthday','Wedding','Corporate','Community','House Party','Festival','Other'];

export interface OnboardingInterestsScreenProps {
  onContinue: (selected: string[]) => void;
  onSkip: () => void;
}

export const OnboardingInterestsScreen: React.FC<OnboardingInterestsScreenProps> = ({ onContinue, onSkip }) => {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (item: string) => {
    setSelected(prev => prev.includes(item) ? prev.filter(i => i !== item) : prev.length < 3 ? [...prev, item] : prev);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>What kind of events do you love?</Text>
        <Text style={styles.subtitle}>Pick up to 3. This helps us surface relevant templates.</Text>
        <View style={styles.grid}>
          {interests.map(i => {
            const active = selected.includes(i);
            return (
              <TouchableOpacity key={i} style={[styles.chip, active && styles.chipActive]} onPress={() => toggle(i)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{i}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.skip} onPress={onSkip}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => onContinue(selected)}>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  chip: { backgroundColor: '#FFFFFF', paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg, borderRadius: 24, marginRight: SPACING.md, marginBottom: SPACING.md },
  chipActive: { backgroundColor: COLORS.teal[700] },
  chipText: { color: COLORS.neutral[900] },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' as any },
  skip: { marginTop: SPACING.md, alignItems: 'center' },
  skipText: { color: COLORS.text.secondary },
  button: { height: 56, backgroundColor: COLORS.teal[700], borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginTop: SPACING.xl },
  buttonText: { color: '#FFFFFF', fontSize: TYPOGRAPHY.body.fontSize, fontWeight: '600' as any },
});
