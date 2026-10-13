import React, { useState } from 'react';
import { ScrollView, SafeAreaView, StyleSheet, TouchableOpacity, View, Text, Image } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS, SHADOWS } from '@/constants/theme';

/**
 * Multi-colour card rhythm per docs/BRAND.md 12.7: adjacent cards alternate
 * hue instead of repeating one white card. Tinted cards use pastel washes
 * (dark text on top); no raw hex anywhere.
 */
const LANDING_PRINCIPLES = [
  {
    id: 'one-place',
    title: 'Everyone in one place',
    body: 'Guest list, RSVPs, running order and the group chat that usually lives in four apps. One link, one page, one source of truth.',
    tint: COLORS.pastels.peach,
    icon: '📍',
  },
  {
    id: 'nothing-forgotten',
    title: 'Nothing forgotten',
    body: 'Turn a sticky note into a task, split the cost, and see what is still open. The plan updates for everyone the moment it changes.',
    tint: COLORS.pastels.lavender,
    icon: '✅',
  },
  {
    id: 'get-out-way',
    title: 'Then get out of the way',
    body: 'The work happens before the night. On the night you should be at your own party, not answering the same question eleven times.',
    tint: COLORS.pastels.teal,
    icon: '✨',
  },
];

/**
 * Saturated card fills. Every value is an AA-passing token step that carries
 * white text at body size: coral-700 5.86:1, magenta-700 6.20:1, teal-800
 * 4.73:1, periwinkle-500 6.68:1. The concept's teal-700 is 3.22:1 and is
 * why the 800 step is used here.
 */
const LANDING_ARCHETYPES = [
  {
    id: 'intimate',
    title: 'The Intimate Host',
    description: 'Small groups, personal touches, and conversations that matter.',
    fill: COLORS.pastels.peach,
    icon: '💬',
    textDark: true,
  },
  {
    id: 'curator',
    title: 'The Curator',
    description: 'Themes, playlists, and details that feel intentional.',
    fill: COLORS.pastels.lavender,
    icon: '🎨',
    textDark: true,
  },
  {
    id: 'organizer',
    title: 'The Organizer',
    description: 'Guest lists, budgets, and timelines, all under control.',
    fill: COLORS.pastels.teal,
    icon: '📋',
    textDark: true,
  },
  {
    id: 'social',
    title: 'The Social Connector',
    description: 'Bringing people together who should know each other.',
    fill: COLORS.pastels.coral,
    icon: '🤝',
    textDark: true,
  },
];

export interface LandingScreenProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

const SECTION_HEADING = {
  how: 'Hosting is a logistics problem',
  howAccent: 'right up until it isn\'t',
  style: 'Four kinds of host',
  styleAccent: 'Pick the one that stings',
};

export const LandingScreen: React.FC<LandingScreenProps> = ({ onGetStarted, onSignIn }) => {
  const [selectedArchetype, setSelectedArchetype] = useState(0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.balloonBackground} pointerEvents="none">
        <View style={[styles.balloon, styles.balloon1]} />
        <View style={[styles.balloon, styles.balloon2]} />
        <View style={[styles.balloon, styles.balloon3]} />
        <View style={[styles.balloon, styles.balloon4]} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.heroContainer}>
          <View style={styles.heroCurve} />

          <View style={styles.heroContentWrap}>
            <View style={styles.heroIconWrap}>
              <Image source={require('@/assets/images/icon.png')} style={styles.heroIcon} resizeMode="contain" />
            </View>
            <Text style={styles.heroBadge}>PLAN. PARTY. PERFECT.</Text>
            <Text style={styles.heroTitle}>
              Throw the party.
              <Text style={styles.heroAccent}> Skip the admin.</Text>
            </Text>
            <Text style={styles.heroSubtitle}>
              Guest list, invites, RSVPs, running order and who owes what. PartyHause keeps all of it in one place so the night belongs to you too.
            </Text>
            <View style={styles.heroActions}>
              <TouchableOpacity style={styles.primaryButton} onPress={onGetStarted}>
                <Text style={styles.primaryButtonText}>Create your event</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={onSignIn}>
                <Text style={styles.secondaryButtonText}>I have an invite</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* How it works */}
        <View style={styles.section}>
          <Text style={styles.sectionLead}>{SECTION_HEADING.how}</Text>
          <Text style={styles.sectionAccent}>{SECTION_HEADING.howAccent}</Text>
          <Text style={styles.sectionBody}>Most of the work happens in the two weeks nobody sees. PartyHause takes that part.</Text>
          
          <View style={styles.principlesGrid}>
            {LANDING_PRINCIPLES.map((p) => (
              <View key={p.id} style={[styles.principleCard, { backgroundColor: p.tint }]}>
                <View style={styles.principleIcon}>
                  <Text style={styles.principleIconText}>{p.icon}</Text>
                </View>
                <Text style={styles.principleTitle}>{p.title}</Text>
                <Text style={styles.principleBody}>{p.body}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Find your style */}
        <View style={[styles.section, styles.sectionAlt]}>
          <Text style={styles.sectionLead}>{SECTION_HEADING.style}</Text>
          <Text style={styles.sectionAccent}>{SECTION_HEADING.styleAccent}</Text>
          <Text style={styles.sectionBody}>Not a personality test. It changes which templates, checklists and timings we put in front of you first.</Text>
          
          <View style={styles.archetypeGrid}>
            {LANDING_ARCHETYPES.map((a, idx) => {
              const isSelected = selectedArchetype === idx;
              return (
                <TouchableOpacity
                  key={a.id}
                  style={[
                    styles.archetypeCard,
                    { backgroundColor: a.fill },
                    isSelected && styles.archetypeCardSelected,
                  ]}
                  onPress={() => setSelectedArchetype(idx)}
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={styles.archetypeIcon}>
                    <Text style={styles.archetypeIconText}>{a.icon}</Text>
                  </View>
                  <Text style={styles.archetypeTitle}>{a.title}</Text>
                  <Text style={styles.archetypeBody}>{a.description}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          
          <View style={styles.archetypeHighlight}>
            <Text style={styles.archetypeHighlightTitle}>{LANDING_ARCHETYPES[selectedArchetype].title}</Text>
            <Text style={styles.archetypeHighlightBody}>
              {LANDING_ARCHETYPES[selectedArchetype].description} Get a tailored checklist, timeline, and templates built for this hosting style.
            </Text>
          </View>
        </View>

        {/* CTA */}
        <View style={styles.ctaSection}>
          <View style={styles.ctaIconWrap}>
            <Text style={styles.ctaIcon}>🎉</Text>
          </View>
          <Text style={styles.ctaTitle}>Ready to throw something unforgettable?</Text>
          <TouchableOpacity style={styles.ctaButton} onPress={onGetStarted}>
            <Text style={styles.ctaButtonText}>Start your event</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>© PartyHause 2026</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream[50],
  },
  // Decorative balloon field behind the hero. pointerEvents="none" in JSX;
  // absolute positions drift at large scale factors like the hero art.
  balloonBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '100%' as any,
    overflow: 'hidden',
  },
  balloon: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.35,
  },
  balloon1: {
    width: 220,
    height: 220,
    top: -60,
    left: -50,
    backgroundColor: COLORS.pastels.coral,
  },
  balloon2: {
    width: 140,
    height: 140,
    top: 40,
    right: -30,
    backgroundColor: COLORS.pastels.periwinkle,
  },
  balloon3: {
    width: 90,
    height: 90,
    top: 220,
    left: 40,
    backgroundColor: COLORS.pastels.teal,
  },
  balloon4: {
    width: 60,
    height: 60,
    top: 300,
    right: 60,
    backgroundColor: COLORS.pastels.peach,
  },
  // Curved hero: cream panel with a rounded bottom edge overlapping the
  // balloon field above it.
  heroContainer: {
    backgroundColor: COLORS.cream[50],
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingBottom: SPACING.xxl,
    marginBottom: SPACING.md,
  },
  heroCurve: {
    height: 32,
    alignSelf: 'stretch',
  },
  heroContentWrap: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: SPACING.xl,
  },
  heroIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.pastels.lavender,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  heroIcon: {
    width: 40,
    height: 40,
    tintColor: COLORS.neutral[900],
  },
  heroBadge: {
    fontSize: TYPOGRAPHY.caption.fontSize,
    fontWeight: '600' as any,
    letterSpacing: 2,
    color: COLORS.neutral[700],
    opacity: 0.9,
    marginBottom: SPACING.md,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 42,
    fontWeight: '700' as any,
    lineHeight: 48,
    color: COLORS.neutral[900],
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  heroAccent: {
    color: COLORS.periwinkle[400],
  },
  heroSubtitle: {
    fontSize: TYPOGRAPHY.body.fontSize,
    lineHeight: 24,
    color: COLORS.neutral[600],
    textAlign: 'center',
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.xxl,
  },
  heroActions: {
    gap: SPACING.md,
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  primaryButton: {
    height: 56,
    backgroundColor: COLORS.pastels.coral,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: COLORS.neutral[900],
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '600' as any,
  },
  secondaryButton: {
    height: 56,
    backgroundColor: COLORS.cream[50],
    borderWidth: 2,
    borderColor: COLORS.pastels.peach,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: COLORS.neutral[900],
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '600' as any,
  },

  section: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxxl,
    backgroundColor: COLORS.cream[50],
  },
  sectionAlt: {
    backgroundColor: COLORS.cream[50],
  },
  sectionLead: {
    fontSize: TYPOGRAPHY.h3.fontSize,
    fontWeight: '600' as any,
    color: COLORS.neutral[900],
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  sectionAccent: {
    fontSize: TYPOGRAPHY.h3.fontSize,
    fontWeight: '600' as any,
    color: COLORS.primary.light,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  sectionBody: {
    fontSize: TYPOGRAPHY.body.fontSize,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.xxl,
    lineHeight: 22,
  },
  principlesGrid: {
    gap: SPACING.lg,
  },
  principleCard: {
    borderRadius: BORDER_RADIUS.xxl,
    padding: SPACING.xl,
  },
  principleIcon: {
    width: 48,
    height: 48,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.neutral[0],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  principleIconImg: {
    width: 32,
    height: 32,
    tintColor: COLORS.neutral[900],
  },
  principleIconText: {
    fontSize: 22,
    color: COLORS.neutral[900],
  },
  principleTitle: {
    fontSize: TYPOGRAPHY.h4.fontSize,
    fontWeight: '600' as any,
    color: COLORS.neutral[900],
    marginBottom: SPACING.sm,
  },
  principleBody: {
    fontSize: TYPOGRAPHY.body.fontSize,
    color: COLORS.neutral[800],
    lineHeight: 22,
  },
  archetypeGrid: {
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  archetypeCard: {
    borderRadius: BORDER_RADIUS.xxl,
    padding: SPACING.xl,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  archetypeCardSelected: {
    borderColor: COLORS.neutral[0],
    ...SHADOWS.medium,
  },
  archetypeIcon: {
    width: 48,
    height: 48,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.neutral[0],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  archetypeIconText: {
    fontSize: 22,
    color: COLORS.neutral[900],
  },
  archetypeTitle: {
    fontSize: TYPOGRAPHY.h4.fontSize,
    fontWeight: '700' as any,
    color: COLORS.neutral[900],
    marginBottom: SPACING.sm,
  },
  archetypeBody: {
    fontSize: TYPOGRAPHY.small.fontSize,
    color: COLORS.neutral[800],
    lineHeight: 20,
  },
  archetypeHighlight: {
    backgroundColor: COLORS.cream[100],
    borderRadius: BORDER_RADIUS.xxl,
    padding: SPACING.xl,
    borderWidth: 2,
    borderColor: COLORS.neutral[300],
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  archetypeHighlightTitle: {
    fontSize: TYPOGRAPHY.h4.fontSize,
    fontWeight: '600' as any,
    color: COLORS.neutral[900],
    marginBottom: SPACING.sm,
  },
  archetypeHighlightBody: {
    fontSize: TYPOGRAPHY.body.fontSize,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  ctaSection: {
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxl,
    borderRadius: BORDER_RADIUS.card,
    alignItems: 'center',
    backgroundColor: COLORS.neutral[950],
  },
  ctaIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.pastels.peach,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  ctaIcon: {
    fontSize: 28,
  },
  ctaTitle: {
    fontSize: TYPOGRAPHY.h3.fontSize,
    fontWeight: '600' as any,
    color: COLORS.text.onDark,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  ctaButton: {
    height: 56,
    backgroundColor: COLORS.neutral[0],
    borderRadius: BORDER_RADIUS.full,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  ctaButtonText: {
    color: COLORS.neutral[900],
    fontSize: TYPOGRAPHY.bodyBold.fontSize,
    fontWeight: '700' as any,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  footerText: {
    fontSize: TYPOGRAPHY.caption.fontSize,
    color: COLORS.text.tertiary,
  },
});
