import React, { useRef, useState } from 'react';
import { ScrollView, SafeAreaView, StyleSheet, Dimensions, TouchableOpacity, View, Text, ImageBackground } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '@/constants/theme';
import { NotchedCard } from '@/components/ui/NotchedCard';
import { MetricPill } from '@/components/ui/MetricPill';


const { height } = Dimensions.get('window');

const LANDING_PRINCIPLES = [
  {
    id: 'one-place',
    title: 'Everyone in one place',
    body: 'Guest list, RSVPs, running order and the group chat that usually lives in four apps. One link, one page, one source of truth.',
    icon: 'users',
  },
  {
    id: 'nothing-forgotten',
    title: 'Nothing forgotten',
    body: 'Turn a sticky note into a task, split the cost, and see what is still open. The plan updates for everyone the moment it changes.',
    icon: 'checklist',
  },
  {
    id: 'get-out-way',
    title: 'Then get out of the way',
    body: 'The work happens before the night. On the night you should be at your own party, not answering the same question eleven times.',
    icon: 'party',
  },
];

const LANDING_ARCHETYPES = [
  {
    id: 'intimate',
    title: 'The Intimate Host',
    description: 'Small groups, personal touches, and conversations that matter.',
    icon: 'heart',
    color: '#C02A16',
  },
  {
    id: 'curator',
    title: 'The Curator',
    description: 'Themes, playlists, and details that feel intentional.',
    icon: 'lightbulb',
    color: '#B62066',
  },
  {
    id: 'organizer',
    title: 'The Organizer',
    description: 'Guest lists, budgets, and timelines — all under control.',
    icon: 'calendar',
    color: '#389F8D',
  },
  {
    id: 'social',
    title: 'The Social Connector',
    description: 'Bringing people together who should know each other.',
    icon: 'users',
    color: '#4133FF',
  },
];

export interface LandingScreenProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

const HERO_IMAGE = 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=1200';
const SECTION_HEADING = {
  how: 'Hosting is a logistics problem',
  howAccent: 'right up until it isn\'t',
  style: 'Four kinds of host',
  styleAccent: 'Pick the one that stings',
};

export const LandingScreen: React.FC<LandingScreenProps> = ({ onGetStarted, onSignIn }) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const [selectedArchetype, setSelectedArchetype] = useState(0);

  const scrollTo = (offset: number) => {
    scrollViewRef.current?.scrollTo({ y: offset, animated: true });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.balloonBackground} pointerEvents="none">
        <View style={[styles.balloon, styles.balloon1]} />
        <View style={[styles.balloon, styles.balloon2]} />
        <View style={[styles.balloon, styles.balloon3]} />
        <View style={[styles.balloon, styles.balloon4]} />
      </View>
      <ScrollView ref={scrollViewRef} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.heroContainer}>
          <View style={styles.heroCurve} />
          <View style={styles.heroContentWrap}>
            <Text style={styles.heroBadge}>Plan. Party. Perfect.</Text>
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
              <View key={p.id} style={styles.principleCard}>
                <View style={styles.principleIcon}>
                  <Text style={styles.principleIconText}>•</Text>
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
                    isSelected && styles.archetypeCardSelected,
                  ]}
                  onPress={() => setSelectedArchetype(idx)}
                >
                  <View style={[styles.archetypeIcon, { backgroundColor: isSelected ? a.color : COLORS.neutral[100] }]}>
                    <Text style={{ color: isSelected ? '#FFFFFF' : COLORS.neutral[600] }}>◈</Text>
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
    backgroundColor: COLORS.cream[100],
  },
  hero: {
    height: height * 0.85,
    justifyContent: 'flex-end',
  },
  heroOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xxxl,
  },
  heroContent: {
    alignItems: 'center',
    width: '100%',
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
    backgroundColor: COLORS.primary.main,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '600' as any,
  },
  secondaryButton: {
    height: 56,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '600' as any,
  },
  section: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxxl,
    backgroundColor: COLORS.cream[100],
  },
  sectionAlt: {
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#FFFFFF',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.neutral[200],
  },
  principleIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  principleIconText: {
    fontSize: 24,
    color: '#FFFFFF',
  },
  principleTitle: {
    fontSize: TYPOGRAPHY.h4.fontSize,
    fontWeight: '600' as any,
    color: COLORS.neutral[900],
    marginBottom: SPACING.sm,
  },
  principleBody: {
    fontSize: TYPOGRAPHY.body.fontSize,
    color: COLORS.text.secondary,
    lineHeight: 22,
  },
  archetypeGrid: {
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  archetypeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.neutral[200],
  },
  archetypeCardSelected: {
    borderColor: COLORS.primary.main,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  archetypeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  archetypeTitle: {
    fontSize: TYPOGRAPHY.h4.fontSize,
    fontWeight: '600' as any,
    color: COLORS.neutral[900],
    marginBottom: SPACING.sm,
  },
  archetypeBody: {
    fontSize: TYPOGRAPHY.body.fontSize,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  archetypeHighlight: {
    backgroundColor: '#FFFFFF',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.neutral[200],
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
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxxl,
    alignItems: 'center',
    backgroundColor: COLORS.cream[100],
  },
  ctaTitle: {
    fontSize: TYPOGRAPHY.h3.fontSize,
    fontWeight: '600' as any,
    color: COLORS.neutral[900],
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  ctaButton: {
    height: 56,
    backgroundColor: COLORS.teal[700],
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xxxl,
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.body.fontSize,
    fontWeight: '600' as any,
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
