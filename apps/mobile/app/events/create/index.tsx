// Event Creation Wizard - Template Selection Screen
// First step: Choose event template

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '@/constants/theme';

const TEMPLATES = [
  {
    id: 'birthday',
    name: 'Birthday Party (Adult)',
    description: 'Celebrate with cocktails & entertainment',
    icon: '🎉',
    color: COLORS.magenta.light,
  },
  {
    id: 'kids-birthday',
    name: 'Kids Birthday Party',
    description: 'Fun activities for children',
    icon: '🎈',
    color: COLORS.warning.light,
  },
  {
    id: 'wedding',
    name: 'Wedding',
    description: 'Plan your special day',
    icon: '💍',
    color: COLORS.magenta.light,
  },
  {
    id: 'product-launch',
    name: 'Product Launch',
    description: 'Showcase your product',
    icon: '🚀',
    color: COLORS.periwinkle[400],
  },
  {
    id: 'fundraiser',
    name: 'Fundraiser',
    description: 'Charity event with auctions',
    icon: '💰',
    color: COLORS.success.light,
  },
  {
    id: 'festival',
    name: 'Music Festival',
    description: 'Multi-stage event',
    icon: '🎵',
    color: COLORS.periwinkle[500],
  },
  {
    id: 'conference',
    name: 'Conference',
    description: 'Professional meetup',
    icon: '🎤',
    color: COLORS.teal[600],
  },
  // TemplateForm has routed 'corporate' to a fully implemented CorporateForm
  // since the template forms were written, but this array never carried the
  // entry. Selection is driven entirely by TEMPLATES.map below and lookup is
  // TEMPLATES.find, so the form was unreachable by every path in the wizard.
  {
    id: 'corporate',
    name: 'Corporate Event',
    description: 'Offsite, all-hands or client hosting',
    icon: '🏢',
    color: COLORS.neutral[600],
  },
  {
    id: 'travel',
    name: 'Group Travel',
    description: 'Multi-day trip planning',
    icon: '✈️',
    color: COLORS.periwinkle[600],
  },
  {
    id: 'block-party',
    name: 'Block Party',
    description: 'Community celebration',
    icon: '🏘️',
    color: COLORS.primary.light,
  },
  {
    id: 'class',
    name: 'Class/Workshop',
    description: 'Learning experience',
    icon: '📚',
    color: COLORS.neutral[500],
  },
  {
    id: 'hackathon',
    name: 'Hackathon',
    description: 'Competitive coding event',
    icon: '💻',
    color: COLORS.cream[700],
  },
];

export default function TemplateSelectionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    title?: string;
    description?: string;
    location?: string;
    startDate?: string;
  }>();

  const handleTemplateSelect = (templateId: string) => {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (template) {
      // The planner's extracted details travel onward when this screen was
      // reached from the assistant without a template match: basics
      // initializes from them, and dropping them here would make the user
      // re-enter everything the planner already extracted.
      router.push({
        pathname: '/events/create/basics',
        params: {
          ...(params.title ? { title: params.title } : {}),
          ...(params.description ? { description: params.description } : {}),
          ...(params.location ? { location: params.location } : {}),
          ...(params.startDate ? { startDate: params.startDate } : {}),
          template: templateId,
          templateName: template.name,
        },
      });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Create Event</Text>
        <Text style={styles.subtitle}>Choose a template to get started</Text>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/*
          The planner sits above the grid rather than inside it. It is not a
          thirteenth template, it is the alternative to choosing one: the user
          describes the event and the planner picks the template, the date and
          the guest count from what they said.
        */}
        <TouchableOpacity
          style={styles.assistantCard}
          onPress={() => router.push('/events/create/assistant')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Plan with AI. Describe your event instead of choosing a template."
        >
          <View style={styles.assistantIcon}>
            <Text style={styles.icon}>✨</Text>
          </View>
          <View style={styles.assistantCopy}>
            <Text style={styles.assistantTitle}>Plan with AI</Text>
            <Text style={styles.assistantSubtitle}>
              Describe your event and we will fill in the details
            </Text>
          </View>
          <Text style={styles.assistantChevron}>›</Text>
        </TouchableOpacity>

        <Text style={styles.divider}>or choose a template</Text>

        <View style={styles.grid}>
          {TEMPLATES.map((template) => (
            <TouchableOpacity
              key={template.id}
              style={[styles.card, { borderColor: template.color }]}
              onPress={() => handleTemplateSelect(template.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconContainer, { backgroundColor: template.color + '20' }]}>
                <Text style={styles.icon}>{template.icon}</Text>
              </View>
              <Text style={styles.cardTitle}>{template.name}</Text>
              <Text style={styles.cardDescription}>{template.description}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    padding: 24,
    paddingTop: 60,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral[200],
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.neutral[900],
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.neutral[600],
  },
  scrollView: {
    flex: 1,
  },
  assistantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 82, 51, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 82, 51, 0.28)',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  assistantIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantCopy: { flex: 1 },
  assistantTitle: { fontSize: 16, fontWeight: '700', color: '#26201D' },
  assistantSubtitle: { fontSize: 13, color: '#6A5E58', marginTop: 2, lineHeight: 18 },
  assistantChevron: { fontSize: 24, color: '#C02A16' },
  divider: {
    textAlign: 'center',
    fontSize: 13,
    color: '#6A5E58',
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  icon: {
    fontSize: 32,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.neutral[900],
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: COLORS.neutral[600],
    lineHeight: 18,
  },
});
