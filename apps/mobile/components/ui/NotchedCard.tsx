import React from 'react';
import { View, StyleSheet } from 'react-native';
import { COLORS, BORDER_RADIUS, SHADOWS, SPACING } from '@/constants/theme';

interface NotchedCardProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  body?: React.ReactNode;
}

export const NotchedCard: React.FC<NotchedCardProps> = ({ children, header, body }) => {
  return (
    <View style={styles.container}>
      {header && <View style={styles.header}>{header}</View>}
      <View style={styles.body}>
        {body ?? children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.cream[50],
    borderRadius: BORDER_RADIUS.card,
    ...SHADOWS.soft,
    overflow: 'hidden',
  },
  header: {
    backgroundColor: COLORS.primary.main,
    borderTopLeftRadius: BORDER_RADIUS.card,
    borderTopRightRadius: BORDER_RADIUS.card,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  body: {
    backgroundColor: COLORS.cream[50],
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
    marginTop: -SPACING.xs,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});
