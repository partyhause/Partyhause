import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '@/lib/client';
import { toLocalEvents } from '@/lib/mappers';
import { EventCardCarousel } from '@/components/cards/EventCardCarousel';
import { Event } from '@/types/event';
import { COLORS } from '@/constants/theme';

interface DashboardScreenProps {
  userId: string;
  userEmail: string;
  onSignOut: () => void;
}

/** Pure: formats an ISO string as a short date label. */
const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const DashboardScreen = ({ userId, userEmail, onSignOut }: DashboardScreenProps) => {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  // The carousel reports its page but nothing on this screen reads it; the
  // setter alone satisfies the required onIndexChange prop.
  const [, setCurrentEventIndex] = useState(0);
  // Impure clock reads belong in lazy initializers, not render: the new
  // react-hooks/purity rule rejects Date.now()/new Date() during render.
  // Both values are display thresholds, stale by one mount at worst.
  const [todayLabel] = useState(() => formatDate(new Date().toISOString()).toUpperCase());
  const [now] = useState(() => Date.now());

  const { data: events = [], isLoading, error: eventsError, refetch } = useQuery<Event[]>({
    queryKey: ['user-events', userId],
    queryFn: async () => {
      if (!userId) return [];

      // The old query was .from('events').eq('host_id', userId)
      // .order('start_date'). GET /api/events already scopes to the caller and
      // orders by start_date ascending (server/routes/events.ts), so both
      // clauses are redundant here.
      //
      // Behaviour change worth knowing: the server scopes with
      // OR[host_id, co-host, invited guest], where the previous direct query
      // matched host_id alone. The dashboard now also shows events the user was
      // invited to, which matches the web app.
      const { data, error } = await api.events.list();

      if (error) {
        throw new Error(error.message);
      }

      // toLocalEvents maps the API shape onto the local Event type, which
      // requires `title` (the API returns `name`), `template_type` and
      // `status`. See lib/mappers.ts for why that divergence exists.
      return toLocalEvents(data);
    },
    enabled: !!userId,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleCreateEvent = () => {
    router.push('/events/create');
  };

  // Transform events to match carousel component interface
  const carouselEvents = events.map(event => ({
    id: event.id,
    title: event.name || event.title || 'Untitled Event',
    description: event.description,
    template_type: event.template_type || 'default',
    start_date: event.start_date || event.event_date,
    end_date: event.event_date,
    location: event.venue || event.location,
    // Cast matches the CHECK constraint on events.status; the previous cast
    // asserted 'cancelled', which the column does not accept.
    status: (event.status || 'published') as 'draft' | 'published' | 'active' | 'completed' | 'archived',
    settings: {},
  }));

  const draftCount = events.filter(event => (event.status || 'published') === 'draft').length;
  const upcomingCount = events.filter(event => {
    const date = event.start_date || event.event_date;
    return date ? new Date(date).getTime() >= now : false;
  }).length;

  return (
    <View style={styles.container}>
      {/* Coloured header block over the cream sheet: docs/BRAND.md section 12.3
          pattern 2. The block carries the greeting and the screen's one
          oversized metric; the sheet holds the content and overlaps upward. */}
      <LinearGradient
        colors={[COLORS.periwinkle[400], COLORS.periwinkle[600]]}
        style={styles.headerBlock}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.header}>
          <View style={styles.headerIntro}>
            <Text style={styles.overline}>{todayLabel.toUpperCase()}</Text>
            <Text style={styles.greeting}>Hey there! 👋</Text>
            <Text style={styles.email} numberOfLines={1}>{userEmail}</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerChip}
              onPress={() => router.push(`/profile/${userId}` as any)}
            >
              <Ionicons name="person-circle-outline" size={24} color={COLORS.text.onDark} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerChip}
              onPress={() => router.push('/events/drafts')}
            >
              <Ionicons name="document-text-outline" size={20} color={COLORS.text.onDark} />
            </TouchableOpacity>
            {/* The only entry point to account settings, and therefore to account
                deletion. App Store guideline 5.1.1(v) requires that path to exist
                for any app that creates accounts; before this control there was
                no route to it from anywhere in the signed-in app. */}
            <TouchableOpacity
              style={styles.headerChip}
              onPress={() => router.push('/settings')}
              accessibilityLabel="Account settings"
            >
              <Ionicons name="settings-outline" size={22} color={COLORS.text.onDark} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.signOutButton} onPress={onSignOut}>
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* One oversized metric per screen: docs/BRAND.md section 12.2. */}
        {events.length > 0 && (
          <View style={styles.metric}>
            <Text style={styles.metricNumber}>{events.length}</Text>
            <Text style={styles.metricCaption}>
              {events.length === 1 ? 'EVENT ON THE BOARD' : 'EVENTS ON THE BOARD'}
            </Text>
          </View>
        )}
      </LinearGradient>

      {/* Cream content sheet, radius about 28px, overlapping the header block. */}
      <View style={styles.sheet}>
        <View style={styles.content}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.periwinkle[500]} />
              <Text style={styles.loadingText}>Loading your events...</Text>
            </View>
          ) : eventsError ? (
            // A failed query renders as "No events yet" otherwise, which reads
            // as genuinely empty. The failure gets its own state with a retry.
            <ScrollView
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.periwinkle[500]} />
              }
            >
              <View style={styles.emptyState}>
                <Ionicons name="cloud-offline-outline" size={40} color={COLORS.neutral[300]} />
                <Text style={styles.emptyTitle}>Could not load your events</Text>
                <Text style={styles.emptyText}>{eventsError.message}</Text>
                <TouchableOpacity style={styles.createButton} onPress={() => { void refetch(); }}>
                  <Ionicons name="refresh" size={20} color={COLORS.text.inverse} />
                  <Text style={styles.createButtonText}>Try Again</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : events.length === 0 ? (
            <ScrollView
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.periwinkle[500]} />
              }
            >
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🎈</Text>
                <Text style={styles.emptyTitle}>No events yet</Text>
                <Text style={styles.emptyText}>
                  Create your first event and start inviting guests!
                </Text>
                <TouchableOpacity style={styles.createButton} onPress={handleCreateEvent}>
                  <Ionicons name="add-circle" size={20} color={COLORS.text.inverse} />
                  <Text style={styles.createButtonText}>Create Your First Event</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            <>
              {/* Dotted-border stat pills: the concept's signature detail. */}
              <View style={styles.statPills}>
                <View style={styles.statPill}>
                  <Ionicons name="calendar" size={18} color={COLORS.periwinkle[500]} />
                  <Text style={styles.statValue}>{events.length}</Text>
                  <Text style={styles.statLabel}>Total</Text>
                </View>
                <View style={styles.statPill}>
                  <Ionicons name="document-text" size={18} color={COLORS.warning.main} />
                  <Text style={styles.statValue}>{draftCount}</Text>
                  <Text style={styles.statLabel}>Drafts</Text>
                </View>
                <View style={styles.statPill}>
                  <Ionicons name="time" size={18} color={COLORS.teal[800]} />
                  <Text style={styles.statValue}>{upcomingCount}</Text>
                  <Text style={styles.statLabel}>Upcoming</Text>
                </View>
              </View>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Your Events</Text>
                <Text style={styles.sectionSubtitle}>
                  {events.length} {events.length === 1 ? 'event' : 'events'} • Swipe to navigate
                </Text>
              </View>
              <View style={styles.carouselContainer}>
                <EventCardCarousel
                  events={carouselEvents}
                  onEventPress={(event) => router.push(`/events/${event.id}` as any)}
                  onIndexChange={setCurrentEventIndex}
                  currentUserId={userId}
                />
              </View>
            </>
          )}
        </View>
      </View>

      {/* Floating Create Button */}
      {events.length > 0 && (
        <TouchableOpacity
          style={styles.fab}
          onPress={handleCreateEvent}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={[COLORS.primary.light, COLORS.primary.main]}
            style={styles.fabGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Ionicons name="add" size={28} color={COLORS.text.inverse} />
          </LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background.secondary,
  },
  headerBlock: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerIntro: {
    flex: 1,
    marginRight: 8,
  },
  overline: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: COLORS.periwinkle[100],
    marginBottom: 4,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text.onDark,
    marginBottom: 2,
  },
  email: {
    fontSize: 14,
    color: COLORS.periwinkle[100],
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  headerChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signOutButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  signOutText: {
    color: COLORS.text.onDark,
    fontSize: 13,
    fontWeight: '600',
  },
  metric: {
    marginTop: 28,
  },
  metricNumber: {
    fontSize: 64,
    fontWeight: '700',
    color: COLORS.text.onDark,
    letterSpacing: -1.2,
    lineHeight: 68,
  },
  metricCaption: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: COLORS.periwinkle[100],
    marginTop: 4,
  },
  sheet: {
    flex: 1,
    backgroundColor: COLORS.background.secondary,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -24,
  },
  content: {
    flex: 1,
  },
  carouselContainer: {
    flex: 1,
  },
  statPills: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 32,
    gap: 12,
  },
  statPill: {
    flex: 1,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.cream[300],
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.background.primary,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text.primary,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.text.secondary,
  },
  section: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text.primary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.text.secondary,
  },
  loadingContainer: {
    padding: 48,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: COLORS.text.secondary,
  },
  emptyState: {
    paddingHorizontal: 24,
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text.primary,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary.main,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    gap: 8,
    shadowColor: COLORS.primary.main,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  createButtonText: {
    color: COLORS.text.inverse,
    fontSize: 16,
    fontWeight: '700',
  },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: COLORS.primary.main,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  fabGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
