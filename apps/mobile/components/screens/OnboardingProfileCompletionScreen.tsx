import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, SafeAreaView } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '@/constants/theme';

export interface OnboardingProfileCompletionScreenProps {
  onDone: (data: { displayName: string; username: string; marketingOptIn: boolean }) => void;
}

export const OnboardingProfileCompletionScreen: React.FC<OnboardingProfileCompletionScreenProps> = ({ onDone }) => {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Finish your profile</Text>
        <TextInput style={styles.input} placeholder="Display name" value={displayName} onChangeText={setDisplayName} />
        <TextInput style={styles.input} placeholder="Username @" value={username} onChangeText={setUsername} />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Get tips and event inspiration</Text>
          <Switch value={marketingOptIn} onValueChange={setMarketingOptIn} />
        </View>
        <TouchableOpacity style={styles.button} onPress={() => onDone({ displayName, username, marketingOptIn })}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background.secondary },
  content: { flex: 1, padding: SPACING.xxl, justifyContent: 'center' },
  title: { fontSize: TYPOGRAPHY.h1.fontSize, fontWeight: '700' as any, color: COLORS.neutral[900], marginBottom: SPACING.xl, textAlign: 'center' },
  input: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.md, fontSize: TYPOGRAPHY.body.fontSize },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: SPACING.md },
  switchLabel: { fontSize: TYPOGRAPHY.body.fontSize, color: COLORS.neutral[900] },
  button: { height: 56, backgroundColor: COLORS.teal[700], borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginTop: SPACING.xl },
  buttonText: { color: '#FFFFFF', fontSize: TYPOGRAPHY.body.fontSize, fontWeight: '600' as any },
});
