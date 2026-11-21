import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { COLORS } from '@/constants/theme';

/** Matches the server's rule (packages/core/src/contracts/guest.ts). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The batch contract caps one import at 50 guests. */
const MAX_GUESTS = 50;

interface Guest {
  id: string;
  name: string;
  email: string;
  phone: string;
  plus_ones: number;
}

export default function GuestsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  
  const [guests, setGuests] = useState<Guest[]>([]);
  const [newGuest, setNewGuest] = useState({
    name: '',
    email: '',
    phone: '',
    plus_ones: 0,
  });

  // Add guest manually
  const addGuest = () => {
    if (!newGuest.name.trim()) {
      Alert.alert('Error', 'Please enter a guest name');
      return;
    }

    // The batch the publish step sends requires a valid address per guest
    // (guestCreateBatch regex-validates it, and the guests_normalized_email
    // trigger refuses an empty one), so an email-less guest accepted here
    // would 400 the whole import at publish and every guest on it would be
    // dropped. Refusing at the point of entry keeps the failure where it can
    // be fixed.
    const email = newGuest.email.trim();
    if (!EMAIL_RE.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address. Invitations are sent by email, so every guest needs one.');
      return;
    }

    // Same duplicate rule the contacts path applies: the database carries a
    // unique index on (event_id, normalized_email), so a duplicate accepted
    // here would 500 the whole import at publish instead of creating a second
    // row.
    if (guests.some((g) => g.email.toLowerCase() === email.toLowerCase())) {
      Alert.alert('Already on the list', `${newGuest.name.trim()} is already a guest.`);
      return;
    }

    if (guests.length >= MAX_GUESTS) {
      Alert.alert('List is full', `An invitation import is capped at ${MAX_GUESTS} guests.`);
      return;
    }

    const guest: Guest = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...newGuest,
      email,
    };

    setGuests([...guests, guest]);
    setNewGuest({ name: '', email: '', phone: '', plus_ones: 0 });
  };

  // Remove guest
  const removeGuest = (id: string) => {
    setGuests(guests.filter(g => g.id !== id));
  };

  /**
   * Add one guest from the system contact picker.
   *
   * This replaces a bulk read. The previous implementation called
   * `requestPermissionsAsync()` for the whole address book, then
   * `getContactsAsync()` with no filter, then staged `data.slice(0, 50)` as
   * guests automatically. Three separate problems, which together are
   * GAP-IOS-01:
   *
   *   it read every contact the user has, to use at most fifty
   *   it chose which fifty by array order, which is not a choice the user made
   *   it added them as guests without anyone confirming a single one
   *
   * `presentContactPickerAsync` hands the selection to the operating system.
   * The app receives exactly one record, the one the user tapped, and never
   * sees the rest of the address book. On iOS this is also the path that does
   * not require NSContactsUsageDescription at all, because nothing is read
   * without an explicit per-contact choice.
   *
   * Picking one at a time is deliberately slower than importing fifty. Adding
   * fifty people to an invitation list without looking at them is not a feature.
   */
  const importFromContacts = async () => {
    try {
      const contact = await Contacts.presentContactPickerAsync();

      // Null means the user dismissed the picker. That is a normal outcome and
      // not an error, so it passes silently.
      if (!contact) return;

      const email = contact.emails?.[0]?.email?.trim() ?? '';
      const phone = contact.phoneNumbers?.[0]?.number?.trim() ?? '';

      // Email is required, not email-or-phone. Invitations are sent by email
      // and the batch the publish step sends requires a valid address per
      // guest, so a phone-only contact accepted here would fail the whole
      // import at publish and every guest on it would be dropped.
      if (!email || !EMAIL_RE.test(email)) {
        Alert.alert(
          'No email address',
          `${contact.name || 'That contact'} has no usable email address saved, so there is no way to send them an invitation. Add them manually with an email instead.`,
        );
        return;
      }

      // Refuse a duplicate rather than silently creating a second row that
      // would later produce two invitations to the same address.
      const alreadyAdded = guests.some(
        (g) => (email && g.email.toLowerCase() === email.toLowerCase()) || (phone && g.phone === phone),
      );
      if (alreadyAdded) {
        Alert.alert('Already on the list', `${contact.name || 'That contact'} is already a guest.`);
        return;
      }

      setGuests([
        ...guests,
        {
          id: contact.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: contact.name?.trim() || email || phone,
          email,
          phone,
          plus_ones: 0,
        },
      ]);
    } catch {
      Alert.alert('Could not open contacts', 'Add this guest manually instead.');
    }
  };

  // Continue to next step
  const handleContinue = () => {
    if (guests.length === 0) {
      Alert.alert(
        'No Guests',
        'You can add guests later, or add some now.',
        [
          { text: 'Add Guests', style: 'cancel' },
          {
            text: 'Skip',
            onPress: () => router.push({
              pathname: '/events/create/timeline',
              params: { ...params, guestCount: '0' },
            }),
          },
        ]
      );
      return;
    }

    // Pass guest data to next screen
    router.push({
      pathname: '/events/create/timeline',
      params: { 
        ...params, 
        guests: JSON.stringify(guests),
        guestCount: guests.length.toString(),
      },
    });
  };

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Guest List</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Progress Indicator */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressDot, styles.progressDotActive]} />
        <View style={[styles.progressLine, styles.progressLineActive]} />
        <View style={[styles.progressDot, styles.progressDotActive]} />
        <View style={[styles.progressLine, styles.progressLineActive]} />
        <View style={[styles.progressDot, styles.progressDotActive]} />
        <View style={styles.progressLine} />
        <View style={styles.progressDot} />
        <View style={styles.progressLine} />
        <View style={styles.progressDot} />
      </View>
      <Text style={styles.stepText}>Step 3 of 5</Text>

      {/* Import Options */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Import Guests</Text>
        <TouchableOpacity
          style={styles.importButton}
          onPress={importFromContacts}
        >
          <Ionicons name="people" size={24} color={COLORS.primary.main} />
          <Text style={styles.importButtonText}>From Contacts</Text>
        </TouchableOpacity>
      </View>

      {/* Manual Add Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Add Manually</Text>
        
        <TextInput
          style={styles.input}
          placeholder="Guest Name *"
          value={newGuest.name}
          onChangeText={(text) => setNewGuest({ ...newGuest, name: text })}
        />

        <TextInput
          style={styles.input}
          placeholder="Email *"
          value={newGuest.email}
          onChangeText={(text) => setNewGuest({ ...newGuest, email: text })}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          style={styles.input}
          placeholder="Phone"
          value={newGuest.phone}
          onChangeText={(text) => setNewGuest({ ...newGuest, phone: text })}
          keyboardType="phone-pad"
        />

        <View style={styles.plusOneContainer}>
          <Text style={styles.plusOneLabel}>Plus Ones</Text>
          <View style={styles.plusOneControls}>
            <TouchableOpacity
              style={styles.plusOneButton}
              onPress={() =>
                setNewGuest({
                  ...newGuest,
                  plus_ones: Math.max(0, newGuest.plus_ones - 1),
                })
              }
            >
              <Ionicons name="remove" size={20} color={COLORS.primary.main} />
            </TouchableOpacity>
            <Text style={styles.plusOneValue}>{newGuest.plus_ones}</Text>
            <TouchableOpacity
              style={styles.plusOneButton}
              onPress={() =>
                setNewGuest({ ...newGuest, plus_ones: newGuest.plus_ones + 1 })
              }
            >
              <Ionicons name="add" size={20} color={COLORS.primary.main} />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.addButton} onPress={addGuest}>
          <Ionicons name="person-add" size={20} color="#FFF" />
          <Text style={styles.addButtonText}>Add Guest</Text>
        </TouchableOpacity>
      </View>

      {/* Guest List */}
      {guests.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Guest List ({guests.length})
          </Text>
          {guests.map((guest) => (
            <View key={guest.id} style={styles.guestCard}>
              <View style={styles.guestInfo}>
                <Text style={styles.guestName}>{guest.name}</Text>
                {guest.email ? (
                  <Text style={styles.guestDetail}>{guest.email}</Text>
                ) : null}
                {guest.phone ? (
                  <Text style={styles.guestDetail}>{guest.phone}</Text>
                ) : null}
                {guest.plus_ones > 0 ? (
                  <Text style={styles.guestPlusOne}>+{guest.plus_ones}</Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => removeGuest(guest.id)}>
                <Ionicons name="trash-outline" size={20} color={COLORS.error.main} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Continue Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.continueButton}
          onPress={handleContinue}
        >
          <Text style={styles.continueButtonText}>Continue</Text>
          <Ionicons name="arrow-forward" size={20} color="#FFF" />
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  importButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  importButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: COLORS.periwinkle[50],
    borderRadius: 8,
    gap: 8,
  },
  importButtonText: {
    color: COLORS.primary.main,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.neutral[300],
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: '#FFF',
  },
  plusOneContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  plusOneLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  plusOneControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  plusOneButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.periwinkle[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusOneValue: {
    fontSize: 18,
    fontWeight: '600',
    minWidth: 30,
    textAlign: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.main,
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  addButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  guestCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: COLORS.background.secondary,
    borderRadius: 8,
    marginBottom: 8,
  },
  guestInfo: {
    flex: 1,
  },
  guestName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  guestDetail: {
    fontSize: 14,
    color: COLORS.neutral[600],
    marginBottom: 2,
  },
  guestPlusOne: {
    fontSize: 14,
    color: COLORS.primary.main,
    fontWeight: '500',
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.main,
    padding: 16,
    borderRadius: 8,
    gap: 8,
  },
  continueButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
