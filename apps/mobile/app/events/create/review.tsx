import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { TimelineBlock } from '@partyhause/core';
import { api } from '@/lib/client';
import { COLORS } from '@/constants/theme';

/**
 * Turn the wizard's "HH:MM" onto the event's day as an absolute instant.
 *
 * `POST /api/timeline` stores a DateTime, so it passes whatever arrives to
 * `new Date()`. A bare "18:30" is not a date and would become Invalid Date;
 * sending an instant removes the ambiguity rather than relying on the server's
 * locale.
 *
 * @param clock "HH:MM" from the timeline step, possibly malformed.
 * @param day The event's start date as an ISO or date string.
 * @returns An ISO-8601 timestamp.
 */
function toIsoStart(clock: string, day: string): string {
  const base = new Date(day);
  const anchor = Number.isNaN(base.getTime()) ? new Date() : base;

  const [hours, minutes] = clock.split(':').map(Number);
  if (Number.isInteger(hours) && Number.isInteger(minutes)) {
    anchor.setHours(hours, minutes, 0, 0);
  }
  return anchor.toISOString();
}

/**
 * Parse a JSON array handed through the wizard as a search param.
 *
 * useLocalSearchParams delivers strings (or an array of them when a key is
 * repeated), so a param that is absent, empty, or not an array parses to an
 * empty one rather than throwing: a malformed step hand-off must not take the
 * publish path down.
 *
 * @param raw The raw search param, if present.
 * @returns The parsed array, or an empty one.
 */
function parseJsonArray(raw: string | string[] | undefined): Array<Record<string, unknown>> {
  if (!raw) return [];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('[')) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

/**
 * Parse the template settings object handed through the wizard as a param.
 *
 * Same contract as parseJsonArray, for the object shape: absent, empty,
 * non-object, or unparseable input resolves to an empty object rather than
 * throwing, because the settings JSONB column is optional and an unusable
 * value must not block publishing.
 *
 * @param raw The raw search param, if present.
 * @returns The parsed object, or an empty one.
 */
function parseJsonObject(raw: string | string[] | undefined): Record<string, unknown> {
  if (!raw) return {};
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null' || !trimmed.startsWith('{')) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export default function ReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const [isPublishing, setIsPublishing] = useState(false);

  // Parse data from params
  const templateType = params.template as string;
  const title = params.title as string;
  const description = params.description as string;
  const startDate = params.startDate as string;
  const endDate = params.endDate as string;
  const location = params.location as string;
  const guestCount = params.guestCount as string || '0';
  const timelineCount = params.timelineCount as string || '0';
  const isDraft = params.isDraft === 'true';
  const draftId = params.draftId as string;

  const templateSettings = parseJsonObject(params.templateSettings);
  const guestsToImport = parseJsonArray(params.guests);
  const timelineBlocks = parseJsonArray(params.timeline);

  /**
   * Publish. One ref-guarded entry: a rapid double-tap can fire onPress twice
   * before the re-render commits, and this flow's writes carry no idempotency
   * key (the legacy flat routers, which the transport never retries), so two
   * taps would create two events. The ref check is the same guard the Cancel
   * Event control uses; the disabled state drives the UI only.
   */
  const busyRef = useRef(false);

  const handlePublish = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsPublishing(true);

    try {
      if (!(await api.auth.isAuthenticated())) {
        Alert.alert('Error', 'Please sign in to create events');
        return;
      }

      // Prepare event data
      const eventData: any = {
        template_type: templateType,
        title,
        description,
        start_date: startDate,
        end_date: endDate,
        privacy: 'private',
        status: 'published',
        settings: templateSettings, // Template-specific settings stored in settings JSONB field
      };

      // Format location properly - API expects object or null
      if (location && location.trim()) {
        eventData.location = {
          name: location,
          address: location,
        };
      }

      // Create event
      const { data: createdEvent, error: createError } = await api.events.create(eventData);

      if (createError) {
        throw new Error(createError.message || 'Failed to create event');
      }

      const eventId = createdEvent?.id;
      if (!eventId) {
        throw new Error('Event created but no ID returned');
      }

      // Import guests if any.
      //
      // The route reads camelCase per guest. This previously sent
      // `plus_ones`, which is not a key it looks at, so every imported
      // guest was created with plus_ones 0.
      //
      // It also sent `eventDetails` and `sendInvitations: true`. The
      // route destructures only `{ eventId, guests }` and ignores both,
      // so no invitation email was ever triggered here despite the flag.
      // Guests are created; inviting them is a separate step.
      //
      // A failure here is reported, not swallowed. The guests step refuses
      // email-less, duplicate and over-cap entries, but a draft saved before
      // that gate existed can still carry data the batch rejects, and the
      // batch is all-or-nothing: one bad guest and the database holds zero
      // of them. Reporting it is what keeps the success dialog honest.
      let guestFailure: string | null = null;
      if (guestsToImport.length > 0) {
        const { error: guestsError } = await api.guests.createMany(
          eventId,
          guestsToImport.map((guest) => ({
            name: String(guest.name ?? ''),
            email: guest.email ? String(guest.email) : undefined,
            phone: guest.phone ? String(guest.phone) : undefined,
            plusOnes: Number(guest.plus_ones ?? 0),
          })),
        );

        if (guestsError) {
          guestFailure = guestsError.message;
        }
      }

      // Create timeline if any.
      //
      // Written to /api/timeline, not onto the event's JSON column.
      //
      // History, because this has now been wrong twice. It originally
      // sent `{ event_id, blocks: [...] }` to POST /api/timeline, which
      // creates ONE block and validates different field names, so it
      // 400'd every time and the schedule was lost inside the catch
      // below. The fix at the time was to write the JSON column instead,
      // on the grounds that the relational table was the one nothing
      // read.
      //
      // That is no longer true, and the JSON column is the wrong target:
      // `serialiseEvent` withholds it from every client including the
      // host, deliberately, because it cannot express `guest_visible` or
      // `host_notes`. So a schedule written there is invisible to the
      // activities screen, which is the only screen that shows it. The
      // relational table is the representation that carries visibility,
      // and the route filters on it per viewer.
      //
      // One request per block, because the route creates one block per
      // call. The loop is bounded by the wizard's own list, which is
      // built by hand a block at a time.
      const scheduleFailures: string[] = [];
      for (const block of timelineBlocks) {
        const { error: blockError } = await api.timeline.create({
          event_id: eventId,
          label: String(block.label ?? ''),
          start_time: toIsoStart(String(block.start_time ?? ''), startDate),
          duration: Number(block.duration ?? 0),
          type: block.type as TimelineBlock['type'],
          description: block.description ? String(block.description) : undefined,
          // The host's per-block toggle, collected at the timeline step. A
          // block marked private must not publish visible to guests; the
          // `!== false` keeps a safe default for a block that predates the
          // switch.
          guest_visible: block.guest_visible !== false,
        });
        if (blockError) scheduleFailures.push(`${String(block.label)}: ${blockError.message}`);
      }

      // If this was a draft, delete it from AsyncStorage. A failed cleanup
      // leaves a stale draft behind, which the drafts screen can delete; it
      // must not fail the publish that just succeeded.
      if (isDraft && draftId) {
        try {
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          const draftsJson = await AsyncStorage.getItem('event_drafts');
          if (draftsJson) {
            const drafts = JSON.parse(draftsJson);
            const updatedDrafts = drafts.filter((d: any) => d.id !== draftId);
            await AsyncStorage.setItem('event_drafts', JSON.stringify(updatedDrafts));
          }
        } catch {
          // Stale draft left in place; deletable from the drafts screen.
        }
      }

      setIsPublishing(false);

      if (guestFailure) {
        Alert.alert(
          'Event created, guests not imported',
          `The event is live, but your guest list could not be imported (${guestFailure}). You can add guests from the event's Guest List screen.`,
          [
            {
              text: 'OK',
              onPress: () => router.replace('/'),
            },
          ]
        );
        return;
      }

      if (scheduleFailures.length > 0) {
        // Reported, not swallowed. The event itself was created, so this
        // is a partial success and the host needs to know which part.
        Alert.alert(
          'Event created, schedule incomplete',
          `${scheduleFailures.length} of ${timelineBlocks.length} activities could not be saved. You can add them from the event's Activities screen.`,
          [
            {
              text: 'OK',
              onPress: () => router.replace('/'),
            },
          ]
        );
        return;
      }

      Alert.alert(
        'Success!',
        'Your event has been created successfully.',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/'),
          },
        ]
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error
        ? error.message
        : 'Failed to create event. Please try again.';
      Alert.alert(
        'Error',
        errorMessage,
        [
          {
            text: 'OK',
          },
        ]
      );
    } finally {
      busyRef.current = false;
      setIsPublishing(false);
    }
  };

  const handleSaveDraft = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsPublishing(true);

    try {
      // Save to AsyncStorage as draft
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;

      const draftData = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        templateType,
        title,
        description,
        startDate,
        endDate,
        location,
        templateSettings,
        guests: params.guests,
        timeline: params.timeline,
        guestCount,
        timelineCount,
        savedAt: new Date().toISOString(),
      };

      // Get existing drafts
      const draftsJson = await AsyncStorage.getItem('event_drafts');
      const drafts = draftsJson ? JSON.parse(draftsJson) : [];

      // Add new draft
      drafts.push(draftData);

      // Save back to storage
      await AsyncStorage.setItem('event_drafts', JSON.stringify(drafts));

      Alert.alert(
        'Draft Saved!',
        'Your event has been saved as a draft. You can continue editing it later.',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/'),
          },
        ]
      );
    } catch {
      Alert.alert('Error', 'Failed to save draft. Please try again.');
    } finally {
      busyRef.current = false;
      setIsPublishing(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Review & Publish</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Progress Indicator */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressDot, styles.progressDotActive]} />
        <View style={[styles.progressLine, styles.progressLineActive]} />
        <View style={[styles.progressDot, styles.progressDotActive]} />
        <View style={[styles.progressLine, styles.progressLineActive]} />
        <View style={[styles.progressDot, styles.progressDotActive]} />
        <View style={[styles.progressLine, styles.progressLineActive]} />
        <View style={[styles.progressDot, styles.progressDotActive]} />
        <View style={[styles.progressLine, styles.progressLineActive]} />
        <View style={[styles.progressDot, styles.progressDotActive]} />
      </View>
      <Text style={styles.stepText}>Step 5 of 5</Text>

      {/* Event Summary */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Event Details</Text>
        
        <View style={styles.summaryRow}>
          <Ionicons name="calendar" size={20} color={COLORS.primary.main} />
          <View style={styles.summaryContent}>
            <Text style={styles.summaryLabel}>Template</Text>
            <Text style={styles.summaryValue}>{templateType}</Text>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <Ionicons name="text" size={20} color={COLORS.primary.main} />
          <View style={styles.summaryContent}>
            <Text style={styles.summaryLabel}>Title</Text>
            <Text style={styles.summaryValue}>{title}</Text>
          </View>
        </View>

        {description ? (
          <View style={styles.summaryRow}>
            <Ionicons name="document-text" size={20} color={COLORS.primary.main} />
            <View style={styles.summaryContent}>
              <Text style={styles.summaryLabel}>Description</Text>
              <Text style={styles.summaryValue}>{description}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.summaryRow}>
          <Ionicons name="time" size={20} color={COLORS.primary.main} />
          <View style={styles.summaryContent}>
            <Text style={styles.summaryLabel}>Date & Time</Text>
            <Text style={styles.summaryValue}>
              {startDate} - {endDate}
            </Text>
          </View>
        </View>

        {location ? (
          <View style={styles.summaryRow}>
            <Ionicons name="location" size={20} color={COLORS.primary.main} />
            <View style={styles.summaryContent}>
              <Text style={styles.summaryLabel}>Location</Text>
              <Text style={styles.summaryValue}>{location}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Guest Summary */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Guests</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="pencil" size={18} color={COLORS.primary.main} />
          </TouchableOpacity>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="people" size={24} color={COLORS.primary.main} />
          <Text style={styles.statValue}>{guestCount}</Text>
          <Text style={styles.statLabel}>guests invited</Text>
        </View>
      </View>

      {/* Timeline Summary */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="pencil" size={18} color={COLORS.primary.main} />
          </TouchableOpacity>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="list" size={24} color={COLORS.primary.main} />
          <Text style={styles.statValue}>{timelineCount}</Text>
          <Text style={styles.statLabel}>blocks scheduled</Text>
        </View>
      </View>

      {/* Info Box */}
      <View style={styles.infoBox}>
        <Ionicons name="information-circle" size={24} color={COLORS.primary.main} />
        <View style={styles.infoContent}>
          <Text style={styles.infoTitle}>Ready to publish?</Text>
          <Text style={styles.infoText}>
            Publishing makes the event live. Invitations are sent separately
            from the event's Invites screen, so guests will not be emailed
            until you send them there. You can always edit event details later.
          </Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.draftButton}
          onPress={handleSaveDraft}
          disabled={isPublishing}
        >
          <Ionicons name="save-outline" size={20} color={COLORS.primary.main} />
          <Text style={styles.draftButtonText}>Save as Draft</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.publishButton}
          onPress={handlePublish}
          disabled={isPublishing}
        >
          {isPublishing ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="rocket" size={20} color="#FFF" />
              <Text style={styles.publishButtonText}>Publish Event</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background.secondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFF',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 20,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.neutral[200],
  },
  progressDotActive: {
    backgroundColor: COLORS.primary.main,
  },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: COLORS.neutral[200],
    marginHorizontal: 4,
  },
  progressLineActive: {
    backgroundColor: COLORS.primary.main,
  },
  stepText: {
    textAlign: 'center',
    color: COLORS.neutral[600],
    fontSize: 14,
    marginTop: 8,
  },
  section: {
    backgroundColor: '#FFF',
    padding: 16,
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral[100],
  },
  summaryContent: {
    flex: 1,
    marginLeft: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: COLORS.neutral[600],
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    color: COLORS.neutral[900],
    fontWeight: '500',
  },
  statCard: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: COLORS.background.secondary,
    borderRadius: 8,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.neutral[900],
    marginTop: 8,
  },
  statLabel: {
    fontSize: 14,
    color: COLORS.neutral[600],
    marginTop: 4,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: COLORS.periwinkle[50],
    padding: 16,
    margin: 16,
    borderRadius: 8,
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.neutral[900],
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.periwinkle[700],
    lineHeight: 20,
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  draftButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.primary.main,
    borderRadius: 8,
    gap: 8,
  },
  draftButtonText: {
    color: COLORS.primary.main,
    fontSize: 16,
    fontWeight: '600',
  },
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.main,
    padding: 16,
    borderRadius: 8,
    gap: 8,
  },
  publishButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
