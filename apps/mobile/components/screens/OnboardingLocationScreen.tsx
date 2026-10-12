import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';

export interface OnboardingLocationScreenProps {
  onContinue: (data: { city: string; region: string; country: string }) => void;
  onSkip: () => void;
}

export const OnboardingLocationScreen: React.FC<OnboardingLocationScreenProps> = ({ onContinue, onSkip }) => {
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Where do you host?</Text>
        <Text style={styles.subtitle}>Helps us show nearby events and vendors.</Text>
        <TextInput style={styles.input} placeholder="City" value={city} onChangeText={setCity} />
        <TextInput style={styles.input} placeholder="Region / State" value={region} onChangeText={setRegion} />
        <TextInput style={styles.input} placeholder="Country" value={country} onChangeText={setCountry} />
        <TouchableOpacity style={styles.skip} onPress={onSkip}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => onContinue({ city, region, country })}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background.secondary },
  content: { flex: 1, padding: SPACING.xxl, justifyContent: 'center' },
  title: { fontSize: TYPOGRAPHY.h1.fontSize, fontWeight: '700' as any, color: COLORS.neutral[900], marginBottom: SPACING.md, textAlign: 'center' },
  subtitle: { fontSize: TYPOGRAPHY.body.fontSize, color: COLORS.text.secondary, marginBottom: SPACING.xl, textAlign: 'center' },
  input: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.md, fontSize: TYPOGRAPHY.body.fontSize },
  skip: { marginTop: SPACING.md, alignItems: 'center' },
  skipText: { color: COLORS.text.secondary },
  button: { height: 56, backgroundColor: COLORS.teal[700], borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginTop: SPACING.xl },
  buttonText: { color: '#FFFFFF', fontSize: TYPOGRAPHY.body.fontSize, fontWeight: '600' as any },
});
