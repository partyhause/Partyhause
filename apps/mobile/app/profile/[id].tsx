/**
 * User Profile Screen
 * Shows user profile with stats, events, and PartyCrew integration
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUserProfile } from '@/hooks/partycrew/useUserProfile';
import { JoinCrewButton } from '@/components/partycrew/JoinCrewButton';
import { toLocalEvents } from '@/lib/mappers';
import { api } from '@/lib/client';
import { COLORS } from '@/constants/theme';
import type { Event } from '@/types/event';

export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile, isLoading, error: profileError, refetch } = useUserProfile(id);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  React.useEffect(() => {
    const getUserId = async () => {
      // Reads the cached session from AsyncStorage. currentUserId decides
      // whether this profile renders as the viewer's own, so a null here is
      // not cosmetic: it hides every owner-only control on the screen.
      const user = await api.auth.getCachedUser();
      setCurrentUserId(user?.id ?? null);
    };
    getUserId();
  }, []);

  // Hosted events, fetched only for the viewer's own profile: GET /api/events
  // is scoped to the caller (host, co-host, invited guest) and the server
  // exposes no events-by-user endpoint, so another user's hosted events cannot
  // be listed from here at all. The "Events grid coming soon..." text that
  // used to render instead was the non-functional-surface class the repo
  // removes elsewhere.
  const [hostedEvents, setHostedEvents] = useState<Event[] | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const loadHosted = async () => {
      if (!profile || currentUserId !== profile.id) return;
      const { data, error } = await api.events.list();
      if (cancelled) return;
      if (error || !data) {
        setHostedEvents(null);
        return;
      }
      setHostedEvents(
        toLocalEvents(data).filter((event) => event.host_id === profile.id),
      );
    };
    void loadHosted();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, currentUserId]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary.main} />
      </View>
    );
  }

  if (!profile) {
    // A query failure is not the same as a profile that does not exist: a
    // network error or a 500 renders as "Not Found" otherwise, with no way to
    // retry it. The two states are separated, and the failure offers a retry.
    if (profileError) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={80} color={COLORS.neutral[300]} />
          <Text style={styles.errorTitle}>Could not load profile</Text>
          <Text style={styles.errorText}>{profileError}</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => { void refetch(); }}>
            <Text style={styles.backButtonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="person-circle-outline" size={80} color={COLORS.neutral[300]} />
        <Text style={styles.errorTitle}>Profile Not Found</Text>
          <Text style={styles.errorText}>
            This user profile hasn't been created yet.
          </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
        </View>
      );
  }

  const isOwnProfile = currentUserId === profile.id;

  const handleWebsitePress = () => {
    if (profile.website_url) {
      Linking.openURL(profile.website_url);
    }
  };

  const handleEditProfile = () => {
    // The `as any` that used to be here suppressed a real type error: there was
    // no app/settings/ directory, so this button reached expo-router's
    // unmatched screen. The route exists now and the cast is gone, which means
    // typed routes will catch it if the screen is ever moved again.
    router.push('/settings/profile');
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Cover Photo */}
      {profile.cover_photo_url ? (
        <Image
          source={{ uri: profile.cover_photo_url }}
          style={styles.coverPhoto}
        />
      ) : (
        <View style={[styles.coverPhoto, styles.coverPhotoPlaceholder]} />
      )}

      {/* Profile Header */}
      <View style={styles.profileHeader}>
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          {profile.avatar_url ? (
            <Image
              source={{ uri: profile.avatar_url }}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {profile.display_name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          {profile.is_verified && (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedIcon}>✓</Text>
            </View>
          )}
        </View>

        {/* Name and Username */}
        <View style={styles.nameContainer}>
          <Text style={styles.displayName}>{profile.display_name}</Text>
          <Text style={styles.username}>@{profile.username}</Text>
        </View>

        {/* Action Button */}
        <View style={styles.actionContainer}>
          {isOwnProfile ? (
            <TouchableOpacity
              style={styles.editButton}
              onPress={handleEditProfile}
            >
              <Text style={styles.editButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          ) : (
            <JoinCrewButton
              creatorId={profile.id}
              variant="default"
              onStatusChange={refetch}
            />
          )}
        </View>
      </View>

      {/* Bio */}
      {profile.bio && (
        <View style={styles.bioContainer}>
          <Text style={styles.bioText}>{profile.bio}</Text>
        </View>
      )}

      {/* Location and Website */}
      <View style={styles.detailsContainer}>
        {profile.location && (
          <View style={styles.detailRow}>
            <Text style={styles.detailIcon}>📍</Text>
            <Text style={styles.detailText}>{profile.location}</Text>
          </View>
        )}
        {profile.website_url && (
          <TouchableOpacity style={styles.detailRow} onPress={handleWebsitePress}>
            <Text style={styles.detailIcon}>🔗</Text>
            <Text style={[styles.detailText, styles.linkText]}>
              {profile.website_url.replace(/^https?:\/\//, '')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{profile.partycrew_count}</Text>
          <Text style={styles.statLabel}>PartyCrew</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{profile.crewing_count}</Text>
          <Text style={styles.statLabel}>Crewing</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{profile.events_hosted}</Text>
          <Text style={styles.statLabel}>Events</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{profile.haus_score}</Text>
          <Text style={styles.statLabel}>Haus Score</Text>
        </View>
      </View>

      {/* Mutual Crew */}
      {!isOwnProfile && profile.viewer_is_mutual && (
        <View style={styles.mutualBanner}>
          <Text style={styles.mutualText}>
            ↔️ You're both in each other's PartyCrew
          </Text>
        </View>
      )}

      {/* Private Account Notice */}
      {profile.is_private && !profile.viewer_is_following && !isOwnProfile && (
        <View style={styles.privateBanner}>
          <Text style={styles.privateIcon}>🔒</Text>
          <Text style={styles.privateText}>This account is private</Text>
          <Text style={styles.privateSubtext}>
            Join their PartyCrew to see their content
          </Text>
        </View>
      )}

      {/* Account Type Badge */}
      {profile.account_type !== 'personal' && (
        <View style={styles.accountTypeBadge}>
          <Text style={styles.accountTypeText}>
            {profile.account_type === 'creator' ? '🎨 Creator' : '🏢 Business'}
          </Text>
        </View>
      )}

      {/* Events Section. Hosted events render for the viewer's own profile;
          another user's cannot be listed at all (no events-by-user endpoint),
          so this section belongs to the owner rather than promising a grid
          that does not exist. */}
      {isOwnProfile && (
        <View style={styles.eventsSection}>
          <Text style={styles.sectionTitle}>Hosted Events</Text>
          {profile.events_hosted === 0 || (hostedEvents !== null && hostedEvents.length === 0) ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                You haven't hosted any events yet
              </Text>
            </View>
          ) : hostedEvents === null ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                Your events could not be loaded.
              </Text>
            </View>
          ) : (
            hostedEvents.map((event) => {
              const parsed = event.start_date ? new Date(event.start_date) : null;
              const when =
                parsed && !Number.isNaN(parsed.getTime())
                  ? parsed.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : null;
              return (
                <TouchableOpacity
                  key={event.id}
                  style={styles.eventRow}
                  onPress={() => router.push(`/events/${event.id}` as any)}
                >
                  <View style={styles.eventRowInfo}>
                    <Text style={styles.eventRowTitle}>{event.title}</Text>
                    {when ? <Text style={styles.eventRowDate}>{when}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.neutral[400]} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.neutral[800],
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 15,
    color: COLORS.neutral[600],
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  helpText: {
    fontSize: 13,
    color: COLORS.neutral[400],
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
  backButton: {
    backgroundColor: COLORS.primary.main,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  coverPhoto: {
    width: '100%',
    height: 180,
    backgroundColor: COLORS.neutral[200],
  },
  coverPhotoPlaceholder: {
    backgroundColor: COLORS.neutral[100],
  },
  profileHeader: {
    paddingHorizontal: 16,
    marginTop: -40,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    backgroundColor: COLORS.neutral[200],
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.primary.main,
  },
  avatarText: {
    fontSize: 40,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.periwinkle[500],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  verifiedIcon: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  nameContainer: {
    marginBottom: 16,
  },
  displayName: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.neutral[800],
    marginBottom: 4,
  },
  username: {
    fontSize: 16,
    color: COLORS.neutral[600],
  },
  actionContainer: {
    marginBottom: 16,
  },
  editButton: {
    backgroundColor: COLORS.neutral[100],
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.neutral[800],
  },
  bioContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  bioText: {
    fontSize: 15,
    color: COLORS.neutral[700],
    lineHeight: 22,
  },
  detailsContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  detailText: {
    fontSize: 15,
    color: COLORS.neutral[600],
  },
  linkText: {
    color: COLORS.primary.main,
    textDecorationLine: 'underline',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.neutral[100],
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.neutral[800],
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.neutral[600],
  },
  mutualBanner: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    backgroundColor: 'rgba(16, 188, 131, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.success.main,
  },
  mutualText: {
    fontSize: 14,
    color: COLORS.success.dark,
    textAlign: 'center',
    fontWeight: '600',
  },
  privateBanner: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: COLORS.background.secondary,
    borderRadius: 8,
    alignItems: 'center',
  },
  privateIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  privateText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.neutral[800],
    marginBottom: 4,
  },
  privateSubtext: {
    fontSize: 14,
    color: COLORS.neutral[600],
    textAlign: 'center',
  },
  accountTypeBadge: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 10,
    backgroundColor: 'rgba(246, 170, 40, 0.18)',
    borderRadius: 8,
    alignItems: 'center',
  },
  accountTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.warning.dark,
  },
  eventsSection: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.neutral[800],
    marginBottom: 16,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 15,
    color: COLORS.neutral[400],
    textAlign: 'center',
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 8,
  },
  eventRowInfo: {
    flex: 1,
  },
  eventRowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.neutral[900],
  },
  eventRowDate: {
    fontSize: 13,
    color: COLORS.neutral[500],
    marginTop: 2,
  },
});
