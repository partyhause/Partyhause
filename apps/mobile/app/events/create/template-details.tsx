// Event Creation Wizard - Template-Specific Details Screen
// Step 2.5: Enter template-specific information

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import TemplateForm, { TemplateFormData } from '@/components/forms/TemplateForm';
import { COLORS } from '@/constants/theme';

/**
 * Restore the settings a previous visit to this step produced.
 *
 * Back-navigation from the guests step re-mounts this screen with the same
 * search params, which still carry `templateSettings` as a JSON string.
 * Starting from `{}` threw every answer away and made the user re-enter the
 * whole form. An absent, empty, or unparseable value starts empty rather than
 * throwing; validity is re-derived by the template form itself, which calls
 * `onValidation` on mount.
 *
 * @param raw The raw `templateSettings` search param, if present.
 * @returns The previously entered settings, or an empty record.
 */
function parseTemplateSettings(raw: unknown): TemplateFormData {
  if (typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith('{')) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TemplateFormData;
    }
    return {};
  } catch {
    return {};
  }
}

export default function TemplateDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const [templateData, setTemplateData] = useState<TemplateFormData>(() =>
    parseTemplateSettings(params.templateSettings),
  );
  const [isValid, setIsValid] = useState(false);

  const handleContinue = () => {
    if (!isValid) {
      Alert.alert('Incomplete', 'Please fill in all required fields');
      return;
    }

    // Navigate to guest import with all data
    router.push({
      pathname: '/events/create/guests',
      params: {
        ...params,
        templateSettings: JSON.stringify(templateData),
      },
    });
  };

  const handleSkip = () => {
    // Skip template-specific details and go directly to guests
    router.push({
      pathname: '/events/create/guests',
      params: {
        ...params,
        templateSettings: JSON.stringify({}),
      },
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.neutral[800]} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Event Details</Text>
          <Text style={styles.subtitle}>
            {params.template ? `${String(params.template).replace('-', ' ')} specific details` : 'Additional details'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Progress Indicator */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: '40%' }]} />
        </View>
        <Text style={styles.progressText}>Step 2 of 5</Text>
      </View>

      {/* Template-Specific Form */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <TemplateForm
          template={params.template as string}
          initialData={templateData}
          onChange={setTemplateData}
          onValidation={setIsValid}
        />
      </ScrollView>

      {/* Continue Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueButton, !isValid && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!isValid}
        >
          <Text style={styles.continueButtonText}>Continue</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background.secondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral[200],
  },
  backButton: {
    padding: 4,
  },
  headerText: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.neutral[800],
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.neutral[600],
    marginTop: 2,
    textTransform: 'capitalize',
  },
  skipButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  skipText: {
    fontSize: 16,
    color: COLORS.periwinkle[500],
    fontWeight: '600',
  },
  progressContainer: {
    padding: 20,
    backgroundColor: '#fff',
  },
  progressBar: {
    height: 4,
    backgroundColor: COLORS.neutral[200],
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.periwinkle[500],
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: COLORS.neutral[600],
    marginTop: 8,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  footer: {
    padding: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: COLORS.neutral[200],
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary.main,
    paddingVertical: 16,
    borderRadius: 12,
  },
  continueButtonDisabled: {
    backgroundColor: COLORS.neutral[300],
  },
  continueButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
});
