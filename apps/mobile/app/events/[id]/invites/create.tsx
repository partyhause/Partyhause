import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { INVITE_TEMPLATES } from '@/types/invites';
import { InvitePreview } from '@/components/invites/InvitePreview';
import { api } from '@/lib/client';
import { COLORS } from '@/constants/theme';

/** What InvitePreview renders. */
interface PreviewEvent {
  title: string;
  date: string;
  time: string;
  location: string;
  /** Omitted when the viewer is not the host; InvitePreview hides the line. */
  host_name?: string;
}

/**
 * Split an ISO timestamp into the date and 12-hour time the preview shows.
 *
 * @param iso - `start_date` from the API, an ISO 8601 string
 * @returns `{ date: 'YYYY-MM-DD', time: 'H:MM AM' }`, both empty when unparseable
 *
 * The date parts are taken in the device's local calendar, not from the UTC
 * instant: `toISOString().slice(0, 10)` is the UTC date, and a host west of
 * UTC would see the previous day in the preview. An unparseable date yields
 * empty strings rather than "Invalid Date", which is what
 * `new Date(x).toLocaleTimeString()` renders into the preview when the field
 * is missing.
 */
function splitEventDateTime(iso: string | undefined | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return {
    date: `${year}-${month}-${day}`,
    time: parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

/**
 * Show the host their invitation before it is sent.
 *
 * The screen used to collect a custom message, footer and three display
 * toggles and pass them to the send screen, which used none of them: the
 * server's invitation send accepts a guest list and nothing else, and the
 * emailed invitation is the server's fixed layout built from the event
 * details. A host spent this step writing a message their guests would never
 * see, which is data loss presented as design control.
 *
 * What remains is the one thing this step is for: the preview, rendered from
 * the real event (the hardcoded "Summer BBQ Party" bug is documented below),
 * and the way on to the send screen.
 */
export default function CreateInviteScreen() {
  const { id, templateId } = useLocalSearchParams<{ id: string; templateId: string }>();
  const template = INVITE_TEMPLATES.find(t => t.id === templateId);

  const [eventData, setEventData] = useState<PreviewEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadEvent() {
      if (!id) {
        setLoadError('No event was specified.');
        return;
      }
      const [eventResult, meResult] = await Promise.all([api.events.get(id), api.auth.me()]);
      if (cancelled) return;

      if (eventResult.error || !eventResult.data) {
        setLoadError(eventResult.error?.message ?? 'This event could not be loaded.');
        return;
      }

      const event = eventResult.data;
      const { date, time } = splitEventDateTime(event.start_date);

      // The event DTO carries host_id but no host name, and widening every
      // event response for one preview line is not worth it. The signed-in
      // user's name is only correct when they are the host; a co-host would
      // otherwise see their own name under "Hosted by". When it does not
      // apply, the field is left undefined and InvitePreview omits the line
      // rather than printing a guess.
      const me = meResult.data;
      const hostName =
        me && event.host_id === me.id ? me.name || undefined : undefined;

      setEventData({
        // `title` is not on the wire: server/lib/event-dto.ts:150 emits one
        // field, falling back to the legacy `title` column internally.
        title: event.name,
        date,
        time,
        location: event.location ?? '',
        host_name: hostName,
      });
    }

    void loadEvent();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!template) {
    return (
      <View style={styles.errorContainer}>
        <Text>Template not found</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.error.main} />
        <Text style={styles.errorText}>{loadError}</Text>
      </View>
    );
  }

  // Designing an invitation against placeholder details is what produced the
  // "Summer BBQ Party" bug, so the editor waits for the real event.
  if (!eventData) {
    return (
      <View style={styles.errorContainer}>
        <ActivityIndicator size="large" color={COLORS.primary.main} />
        <Text style={styles.errorText}>Loading your event…</Text>
      </View>
    );
  }

  const handleSaveAndContinue = () => {
    // The template choice and the customization no longer travel onward: the
    // send screen reads the event id and nothing else, because the server's
    // invitation send accepts a guest list and nothing else.
    router.push({
      pathname: `/events/[id]/invites/send` as any,
      params: {
        id,
      },
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={[COLORS.neutral[50], '#FFFFFF']} style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.neutral[900]} />
          </TouchableOpacity>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Preview Invite</Text>
            <Text style={styles.headerSubtitle}>{template.name}</Text>
          </View>
          <TouchableOpacity style={styles.saveButton} onPress={handleSaveAndContinue}>
            <Text style={styles.saveButtonText}>Next</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Preview Section */}
        <View style={styles.previewSection}>
          <Text style={styles.sectionTitle}>Preview</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.previewScrollContent}
          >
            <InvitePreview
              template={template}
              eventData={eventData}
              scale={0.8}
            />
          </ScrollView>
          <Text style={styles.previewNote}>
            This is how your invitation will read. Guests receive it by email
            with a link to reply.
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Back to Templates</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={handleSaveAndContinue}>
          <Text style={styles.primaryButtonText}>Continue to Send</Text>
          <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    color: COLORS.neutral[600],
    textAlign: 'center',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral[200],
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.neutral[900],
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.neutral[600],
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary.main,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  previewSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.neutral[900],
    marginBottom: 16,
  },
  previewScrollContent: {
    paddingRight: 20,
  },
  previewNote: {
    fontSize: 14,
    color: COLORS.neutral[600],
    lineHeight: 20,
    marginTop: 16,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: COLORS.neutral[200],
  },
  secondaryButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.neutral[200],
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.neutral[700],
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.primary.main,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
