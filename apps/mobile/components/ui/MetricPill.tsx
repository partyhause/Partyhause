import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '@/constants/theme';

interface MetricPillProps {
  icon?: string;
  value: string;
  label: string;
  color?: string;
}

export const MetricPill: React.FC<MetricPillProps> = ({ icon, value, label, color = COLORS.teal[500] }) => {
  return (
    <View style={styles.container}>
      <View style={[styles.iconBg, { backgroundColor: color + '20' }]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
  },
  iconBg: {
    width: 48,
    height: 48,
    borderRadius: BORDER_RADIUS.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  icon: {
    fontSize: 20,
  },
  value: {
    ...TYPOGRAPHY.h2,
    fontSize: 24,
    color: COLORS.neutral[900],
  },
  label: {
    ...TYPOGRAPHY.caption,
    color: COLORS.neutral[600],
    marginTop: 2,
  },
});
