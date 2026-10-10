import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Switch } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';

export interface OnboardingFreeTrialPaymentScreenProps {
  onActivate: (plan: string) => void;
}

const plans = [
  { id: 'starter', name: 'Starter', price: '$0', trial: '14 days free' },
  { id: 'pro', name: 'Pro', price: '$19/mo', trial: '14 days free' },
];

export const OnboardingFreeTrialPaymentScreen: React.FC<OnboardingFreeTrialPaymentScreenProps> = ({ onActivate }) => {
  const [selected, setSelected] = useState('starter');
  const [saveCard, setSaveCard] = useState(true);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Activate your free trial</Text>
        <Text style={styles.subtitle}>Add a card to start. You won’t be charged until trial ends.</Text>
        {plans.map(p => (
          <TouchableOpacity key={p.id} style={[styles.card, selected === p.id && styles.cardSelected]} onPress={() => setSelected(p.id)}>
            <Text style={styles.planName}>{p.name}</Text>
            <Text style={styles.planPrice}>{p.price}</Text>
            <Text style={styles.planTrial}>{p.trial}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Save card for future payments</Text>
          <Switch value={saveCard} onValueChange={setSaveCard} />
        </View>
        <TouchableOpacity style={styles.button} onPress={() => onActivate(selected)}>
          <Text style={styles.buttonText}>Start free trial</Text>
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
  card: { backgroundColor: '#FFFFFF', padding: SPACING.lg, borderRadius: 24, marginBottom: SPACING.md, borderWidth: 2, borderColor: 'transparent' },
  cardSelected: { borderColor: COLORS.teal[700], backgroundColor: COLORS.teal[50] },
  planName: { fontSize: TYPOGRAPHY.h2?.fontSize || 20, fontWeight: '600' as any, color: COLORS.neutral[900] },
  planPrice: { fontSize: TYPOGRAPHY.body.fontSize, color: COLORS.neutral[900], marginTop: SPACING.xs },
  planTrial: { fontSize: TYPOGRAPHY.body.fontSize, color: COLORS.text.secondary, marginTop: SPACING.xs },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: SPACING.md },
  switchLabel: { fontSize: TYPOGRAPHY.body.fontSize, color: COLORS.neutral[900] },
  button: { height: 56, backgroundColor: COLORS.teal[700], borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginTop: SPACING.xl },
  buttonText: { color: '#FFFFFF', fontSize: TYPOGRAPHY.body.fontSize, fontWeight: '600' as any },
});
