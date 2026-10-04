import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { createMvpIdempotencyKey } from '@partyhause/core';
import { api } from '@/lib/client';
import { COLORS } from '@/constants/theme';

/** A guest row plus its selection state on this screen. */
interface InviteGuest {
  /** The server's guest id. Required: /api/send-email only accepts addresses
   *  already on this event's guest list, so a guest with no row cannot be
   *  mailed. */
  id: string;
  name: string;
  email: string;
  selected: boolean;
}

/**
 * Delivery statuses that mean the invitation is on its way.
 *
 * `queued` counts. The server hands the message to the provider and reports the
 * outcome of that handoff, not of the eventual inbox delivery, which arrives
 * later by webhook. Treating `queued` as a failure would tell a host their
 * invitation did not send while it was in flight, and the retry that follows
 * would be the thing that actually double-sends.
 */
const DELIVERABLE = new Set(['queued', 'accepted', 'delivered']);

/**
 * Turn a send failure into something a host can act on.
 *
 * The codes are the server's, from server/lib/mvp-invitations.ts. They are
 * matched explicitly rather than shown raw, because the two common ones have
 * specific remedies and the generic message hides both.
 */
function describeSendFailure(error: { code?: string; message: string } | null | undefined): string {
  switch (error?.code) {
    case 'EVENT_NOT_PUBLISHED':
      // Reachable for the first time now that publishing works at all.
      return 'This event is still a draft. Publish it first, then send the invitations.';
    case 'EVENT_NOT_FUTURE':
      return 'This event has already started, so invitations can no longer be sent.';
    case 'INVITATION_RATE_LIMITED':
      return 'You have reached the hourly invitation limit. Try again a little later.';
    default:
      return error?.message ?? 'The send did not complete.';
  }
}

/**
 * Compose and send an event's invitations.
 *
 * WHAT THIS USED TO DO
 *   Rendered four fabricated guests, hardcoded in the source: John Smith,
 *   Jane Doe, Bob Johnson and Alice Williams at @example.com. The Send button
 *   mailed those addresses. It never read the event's real guest list, so a
 *   host who had spent the previous screen adding twenty guests saw four
 *   strangers here instead.
 *
 *   The send could not have worked in any case. /api/send-email requires
 *   authentication (the mobile client sent none), requires `event_id` at the
 *   top level of the body (it was buried in `metadata`), and restricts
 *   recipients to that event's guest list (@example.com is on nobody's).
 *
 * WHY IT NO LONGER USES /api/send-email
 *   That endpoint mails a link to `/event/:eventId/guest/:guestId`, which is
 *   not a route in either client, so every invitation it has ever sent carried
 *   a dead link (defect 4 in docs/ROADMAP.md). It also writes no
 *   `GuestInvitation` row, so no RSVP token existed and the `/join/:token`
 *   page, which is built and works, could never be reached (defect 2).
 *
 *   `api.invitations.send` posts to /api/mvp/events/:id/invitations/send, which
 *   mints the token, renders the invitation server-side and links to
 *   /join/<token>. The host cannot supply addresses or copy: recipients are
 *   guest ids resolved against the event's own list, which is what stops this
 *   endpoint being a relay.
 */
export default function SendInvitesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [event, setEvent] = useState<{
    id: string;
    name: string;
    date: string;
    location: string;
    description?: string;
  } | null>(null);
  const [guests, setGuests] = useState<InviteGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newGuestName, setNewGuestName] = useState('');
  const [newGuestEmail, setNewGuestEmail] = useState('');
  const [isAddingGuest, setIsAddingGuest] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const selectedCount = guests.filter(g => g.selected).length;

  /**
   * One idempotency key per distinct set of recipients.
   *
   * The server stores the key against a hash of `{ eventId, guestIds }` and
   * replays the stored response when both match, so reusing a key for the same
   * selection is what makes a retry safe after a timeout. Generating a fresh
   * key each attempt would make every retry a second command, which is the
   * double-send this header exists to prevent.
   *
   * A *different* selection must not reuse the key: the server answers
   * IDEMPOTENCY_KEY_CONFLICT. Keying the cache on the sorted guest ids gives a
   * new key exactly when the intent is new, which is what the retry-only-the-
   * failures path below relies on.
   */
  const sendKey = React.useRef<{ signature: string; key: string } | null>(null);
  const idempotencyKeyFor = useCallback((guestIds: string[]): string => {
    const signature = [...guestIds].sort().join(',');
    if (sendKey.current?.signature !== signature) {
      sendKey.current = { signature, key: createMvpIdempotencyKey('invitation.send') };
    }
    return sendKey.current.key;
  }, []);

  /** Load the event and its real guest list. Both are required to send. */
  const load = useCallback(async () => {
    if (!id) {
      setLoadError('No event was specified.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const [eventResult, guestResult, meResult] = await Promise.all([
      api.events.get(id),
      api.guests.listForEvent(id),
      api.auth.me(),
    ]);

    if (eventResult.error || !eventResult.data) {
      setLoadError(eventResult.error?.message ?? 'This event could not be loaded.');
      setLoading(false);
      return;
    }

    if (guestResult.error) {
      setLoadError(guestResult.error.message);
      setLoading(false);
      return;
    }

    // The send endpoint locks the event on host, privacy and guest-list shape,
    // and answers 404 EVENT_NOT_FOUND for an event that fails any of them, so
    // a co-host or a non-private event would otherwise be told "Event not
    // found" for the event they are looking at. What the DTO carries is
    // checked here instead, where the reason can be stated.
    const loaded = eventResult.data;
    const me = meResult.data;
    if (me && loaded.host_id !== me.id) {
      setLoadError('Only the event host can send invitations for this event.');
      setLoading(false);
      return;
    }
    if (loaded.privacy && loaded.privacy !== 'private') {
      setLoadError('Invitations can currently only be sent for private events.');
      setLoading(false);
      return;
    }

    setEvent({
      id: loaded.id,
      name: loaded.name,
      date: loaded.start_date ?? '',
      location: loaded.location ?? '',
      description: loaded.description ?? undefined,
    });

    setGuests(
      (guestResult.data ?? [])
        .filter(g => typeof g.email === 'string' && g.email.trim() !== '')
        .map(g => ({
          id: g.id,
          name: g.name || g.email,
          email: g.email,
          selected: false,
        })),
    );

    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleGuest = (guestId: string) => {
    setGuests(prev =>
      prev.map(g => (g.id === guestId ? { ...g, selected: !g.selected } : g))
    );
  };

  const selectAll = () => {
    const allSelected = guests.every(g => g.selected);
    setGuests(prev => prev.map(g => ({ ...g, selected: !allSelected })));
  };

  /**
   * Add a guest to the event, then to this list.
   *
   * The server call is not optional. This used to push a local object with
   * `id: Date.now().toString()` and no persistence, which meant the guest
   * vanished on navigation and, more to the point, was not on the event's
   * guest list, so /api/send-email would refuse to mail them.
   */
  const addNewGuest = async () => {
    const name = newGuestName.trim();
    const email = newGuestEmail.trim().toLowerCase();

    if (!name || !email) {
      Alert.alert('Missing details', 'Enter both a name and an email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert('Invalid email', 'That does not look like an email address.');
      return;
    }

    if (guests.some(g => g.email === email)) {
      Alert.alert('Already invited', `${email} is already on the guest list.`);
      return;
    }

    if (!id) return;

    setIsAddingGuest(true);
    const { data, error } = await api.guests.create(id, { name, email });
    setIsAddingGuest(false);

    if (error || !data) {
      Alert.alert('Could not add guest', error?.message ?? 'The guest was not saved. Try again.');
      return;
    }

    setGuests(prev => [
      ...prev,
      { id: data.id, name: data.name || name, email: data.email || email, selected: true },
    ]);
    setNewGuestName('');
    setNewGuestEmail('');
  };

  const handleSendInvites = async () => {
    const selectedGuests = guests.filter(g => g.selected);

    if (selectedGuests.length === 0) {
      Alert.alert('No Guests Selected', 'Please select at least one guest to send invites to');
      return;
    }

    if (!event) {
      Alert.alert('Not ready', 'The event has not finished loading yet.');
      return;
    }

    Alert.alert(
      'Send Invites?',
      `Send invitations to ${selectedGuests.length} guest${selectedGuests.length > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            const guestIds = selectedGuests.map(g => g.id);
            setIsSending(true);
            const { data, error } = await api.invitations.send(
              id,
              guestIds,
              idempotencyKeyFor(guestIds),
            );
            setIsSending(false);

            if (error || !data) {
              Alert.alert('Invitations not sent', describeSendFailure(error));
              return;
            }

            // A per-guest outcome, not one boolean. The server attempts each
            // recipient separately and reports which provider call succeeded,
            // so a partial send is reported as one. `attempted` separates the
            // two failure kinds: an address whose mail bounced is reported
            // with attempted false, and the server skips it on every retry,
            // so keeping it selected with "you can retry just those" advice
            // would be a no-op the host could repeat forever.
            const failed = new Set(
              data.results
                .filter(item => !DELIVERABLE.has(item.status) && item.attempted)
                .map(item => item.guestId),
            );
            const undeliverable = data.results.filter(
              item => !DELIVERABLE.has(item.status) && !item.attempted,
            );
            const failedIds = new Set([
              ...failed,
              ...undeliverable.map(item => item.guestId),
            ]);
            setGuests(prev => prev.map(g => ({ ...g, selected: failedIds.has(g.id) })));

            if (failed.size === 0 && undeliverable.length === 0) {
              Alert.alert(
                'Invitations sent',
                `Sent to ${data.results.length} guest${data.results.length > 1 ? 's' : ''}. Each one has a private RSVP link.`,
                [{ text: 'OK', onPress: () => router.push(`/events/${id}`) }],
              );
              return;
            }

            if (undeliverable.length > 0 && failed.size === 0) {
              // Only skipped failures: nothing here is retryable, so the
              // guests are deselected and the reason is stated rather than
              // inviting a retry that can never succeed.
              Alert.alert(
                'Invitations could not be delivered',
                `${undeliverable.length} invitation${undeliverable.length > 1 ? 's' : ''} could not be delivered. The addresses refused mail, so retrying will not help. Remove or correct them on the guest list and send again.`,
                [{ text: 'OK', onPress: () => router.push(`/events/${id}`) }],
              );
              return;
            }

            // Attempted failures stay selected, so a retry targets only them.
            // That retry is a different guest set, so it carries a different
            // idempotency key and is a new command rather than a replay.
            const skippedNote = undeliverable.length > 0
              ? `\n\n${undeliverable.length} further invitation${undeliverable.length > 1 ? 's' : ''} could not be delivered at all (the address refused mail); retrying will not help those.`
              : '';
            Alert.alert(
              'Some invitations failed',
              `${data.results.length - failedIds.size} sent, ${failed.size} did not.\n\nThe guests who did not receive one are still selected, so you can retry just those.${skippedNote}`,
            );
          },
        },
      ]
    );
  };

  const renderGuestItem = ({ item }: { item: InviteGuest }) => (
    <TouchableOpacity
      style={[styles.guestItem, item.selected && styles.guestItemSelected]}
      onPress={() => toggleGuest(item.id)}
      activeOpacity={0.7}
    >
      <View style={styles.guestCheckbox}>
        {item.selected && <Ionicons name="checkmark" size={18} color={COLORS.primary.main} />}
      </View>
      <View style={styles.guestInfo}>
        <Text style={styles.guestName}>{item.name}</Text>
        <Text style={styles.guestEmail}>{item.email}</Text>
      </View>
      <Ionicons
        name={item.selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={24}
        color={item.selected ? COLORS.primary.main : COLORS.neutral[300]}
      />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={[COLORS.neutral[50], '#FFFFFF']} style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.neutral[900]} />
          </TouchableOpacity>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Send Invitations</Text>
            <Text style={styles.headerSubtitle}>
              {selectedCount} guest{selectedCount !== 1 ? 's' : ''} selected
            </Text>
          </View>
        </View>
      </LinearGradient>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.main} />
          <Text style={styles.centeredText}>Loading the guest list…</Text>
        </View>
      )}

      {!loading && loadError && (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error.main} />
          <Text style={styles.centeredText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !loadError && (
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Add New Guest */}
        <View style={styles.addGuestCard}>
          <View style={styles.cardHeader}>
            <Ionicons name="person-add" size={24} color={COLORS.primary.main} />
            <Text style={styles.cardTitle}>Add Guest</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Guest name"
            value={newGuestName}
            onChangeText={setNewGuestName}
          />
          <TextInput
            style={styles.input}
            placeholder="Email address"
            value={newGuestEmail}
            onChangeText={setNewGuestEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.addButton, isAddingGuest && styles.addButtonDisabled]}
            onPress={addNewGuest}
            disabled={isAddingGuest}
          >
            {isAddingGuest ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="add-circle" size={20} color="#FFFFFF" />
            )}
            <Text style={styles.addButtonText}>
              {isAddingGuest ? 'Adding…' : 'Add Guest'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Guest List */}
        <View style={styles.guestListCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Ionicons name="people" size={24} color={COLORS.primary.main} />
              <Text style={styles.cardTitle}>Guest List ({guests.length})</Text>
            </View>
            <TouchableOpacity onPress={selectAll}>
              <Text style={styles.selectAllText}>
                {guests.every(g => g.selected) ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={guests}
            renderItem={renderGuestItem}
            keyExtractor={item => item.id}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={48} color={COLORS.neutral[300]} />
                <Text style={styles.emptyStateText}>No guests on this event yet</Text>
                <Text style={styles.emptyStateSubtext}>
                  Add guests above. They are saved to the event, which is what
                  lets us email them.
                </Text>
              </View>
            }
          />
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
      )}

      {/* Bottom Action Bar */}
      {selectedCount > 0 && (
        <View style={styles.bottomBar}>
          <View style={styles.selectedInfo}>
            <Ionicons name="mail" size={20} color={COLORS.primary.main} />
            <Text style={styles.selectedText}>
              {selectedCount} invitation{selectedCount !== 1 ? 's' : ''} ready to send
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
            onPress={handleSendInvites}
            disabled={isSending}
          >
            {isSending ? (
              <Text style={styles.sendButtonText}>Sending...</Text>
            ) : (
              <>
                <Ionicons name="send" size={20} color="#FFFFFF" />
                <Text style={styles.sendButtonText}>Send Invites</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background.secondary,
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
    gap: 16,
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
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.neutral[900],
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.neutral[600],
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  addGuestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  guestListCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.neutral[900],
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary.main,
  },
  input: {
    backgroundColor: COLORS.background.secondary,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: COLORS.neutral[900],
    borderWidth: 1,
    borderColor: COLORS.neutral[200],
    marginBottom: 12,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.main,
    padding: 14,
    borderRadius: 12,
    gap: 8,
  },
  addButtonDisabled: {
    opacity: 0.6,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  centeredText: {
    fontSize: 15,
    color: COLORS.neutral[600],
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.primary.main,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  guestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  guestItemSelected: {
    backgroundColor: COLORS.periwinkle[50],
    paddingHorizontal: 12,
    marginHorizontal: -12,
    borderRadius: 12,
  },
  guestCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.neutral[300],
    justifyContent: 'center',
    alignItems: 'center',
  },
  guestInfo: {
    flex: 1,
  },
  guestName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.neutral[900],
    marginBottom: 2,
  },
  guestEmail: {
    fontSize: 13,
    color: COLORS.neutral[600],
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.neutral[100],
    marginVertical: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.neutral[400],
    marginTop: 12,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: COLORS.neutral[300],
    marginTop: 4,
    textAlign: 'center',
  },
  bottomBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: COLORS.neutral[200],
    padding: 20,
    gap: 12,
  },
  selectedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  selectedText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.neutral[600],
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.main,
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
