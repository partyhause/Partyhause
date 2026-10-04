// Event Creation Wizard - Event Basics Screen
// Step 2: Enter event details (title, dates, location)

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS } from '@/constants/theme';

export default function EventBasicsScreen() {
  const router = useRouter();
  // Prefill params arrive from the AI planner (create/assistant.tsx). They are
  // all optional: reaching this screen by picking a template directly passes
  // only `template`, and every field below falls back to what it used to be.
  //
  // Prefilled, not committed. The user still sees and can change every value
  // before continuing, because the planner infers and inference is sometimes
  // wrong.
  const params = useLocalSearchParams<{
    template: string;
    title?: string;
    description?: string;
    location?: string;
    startDate?: string;
  }>();
  const { template } = params;

  /** A prefilled instant, or null when absent or unparseable. */
  const prefilledStart = (() => {
    if (!params.startDate) return null;
    const at = new Date(params.startDate);
    return Number.isNaN(at.getTime()) ? null : at;
  })();

  const [title, setTitle] = useState(params.title ?? '');
  const [description, setDescription] = useState(params.description ?? '');
  const [startDate, setStartDate] = useState(prefilledStart ?? new Date());
  const [endDate, setEndDate] = useState(
    new Date((prefilledStart ?? new Date()).getTime() + 3 * 60 * 60 * 1000),
  );
  const [location, setLocation] = useState(params.location ?? '');
  // mode="datetime" is iOS-only: @react-native-community/datetimepicker's
  // Android modes are { date, time }, and its default branch opens a date-only
  // picker, so an Android user could never set the event time. Android walks
  // two stages instead (date, then time); iOS keeps the single spinner, which
  // now has Done/Cancel buttons and a field that toggles it closed.
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [androidStartStage, setAndroidStartStage] = useState<'date' | 'time'>('date');
  const [androidEndStage, setAndroidEndStage] = useState<'date' | 'time'>('date');

  const handleContinue = () => {
    // Validate required fields
    if (!title.trim()) {
      Alert.alert('Incomplete', 'Please enter an event title');
      return;
    }

    if (endDate <= startDate) {
      Alert.alert('Invalid dates', 'End date must be after start date');
      return;
    }

    // Navigate to template-specific details first
    router.push({
      pathname: '/events/create/template-details',
      params: {
        template,
        title,
        description,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        location,
      },
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Event Details</Text>
        <Text style={styles.subtitle}>Tell us about your event</Text>
      </View>

      <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
        <View style={styles.field}>
          <Text style={styles.label}>Event Title *</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g., Sarah's 30th Birthday Bash"
            placeholderTextColor="#999"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Add more details about your event..."
            placeholderTextColor="#999"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Start Date & Time *</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => {
              setAndroidStartStage('date');
              setShowStartPicker(!showStartPicker);
            }}
          >
            <Text style={styles.dateText}>
              {startDate.toLocaleString()}
            </Text>
          </TouchableOpacity>
          {showStartPicker && Platform.OS === 'ios' && (
            <View>
              <DateTimePicker
                value={startDate}
                mode="datetime"
                display="spinner"
                onChange={(_event, date) => {
                  if (date) setStartDate(date);
                }}
              />
              <View style={styles.pickerActions}>
                <TouchableOpacity
                  style={styles.pickerAction}
                  onPress={() => setShowStartPicker(false)}
                >
                  <Text style={styles.pickerActionCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pickerAction}
                  onPress={() => setShowStartPicker(false)}
                >
                  <Text style={styles.pickerActionDone}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {showStartPicker && Platform.OS === 'android' && androidStartStage === 'date' && (
            <DateTimePicker
              value={startDate}
              mode="date"
              display="default"
              onChange={(event, date) => {
                if (event.type === 'set' && date) {
                  setStartDate(date);
                  setAndroidStartStage('time');
                } else {
                  setShowStartPicker(false);
                }
              }}
            />
          )}
          {showStartPicker && Platform.OS === 'android' && androidStartStage === 'time' && (
            <DateTimePicker
              value={startDate}
              mode="time"
              display="default"
              is24Hour={false}
              onChange={(event, date) => {
                setShowStartPicker(false);
                setAndroidStartStage('date');
                if (event.type === 'set' && date) setStartDate(date);
              }}
            />
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>End Date & Time *</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => {
              setAndroidEndStage('date');
              setShowEndPicker(!showEndPicker);
            }}
          >
            <Text style={styles.dateText}>
              {endDate.toLocaleString()}
            </Text>
          </TouchableOpacity>
          {showEndPicker && Platform.OS === 'ios' && (
            <View>
              <DateTimePicker
                value={endDate}
                mode="datetime"
                display="spinner"
                onChange={(_event, date) => {
                  if (date) setEndDate(date);
                }}
              />
              <View style={styles.pickerActions}>
                <TouchableOpacity
                  style={styles.pickerAction}
                  onPress={() => setShowEndPicker(false)}
                >
                  <Text style={styles.pickerActionCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pickerAction}
                  onPress={() => setShowEndPicker(false)}
                >
                  <Text style={styles.pickerActionDone}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {showEndPicker && Platform.OS === 'android' && androidEndStage === 'date' && (
            <DateTimePicker
              value={endDate}
              mode="date"
              display="default"
              onChange={(event, date) => {
                if (event.type === 'set' && date) {
                  setEndDate(date);
                  setAndroidEndStage('time');
                } else {
                  setShowEndPicker(false);
                }
              }}
            />
          )}
          {showEndPicker && Platform.OS === 'android' && androidEndStage === 'time' && (
            <DateTimePicker
              value={endDate}
              mode="time"
              display="default"
              is24Hour={false}
              onChange={(event, date) => {
                setShowEndPicker(false);
                setAndroidEndStage('date');
                if (event.type === 'set' && date) setEndDate(date);
              }}
            />
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Location</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="e.g., 123 Main St, City, State"
            placeholderTextColor="#999"
          />
        </View>

        <TouchableOpacity
          style={styles.continueButton}
          onPress={handleContinue}
          activeOpacity={0.8}
        >
          <Text style={styles.continueText}>Continue</Text>
        </TouchableOpacity>
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
  backButton: {
    marginBottom: 12,
  },
  backText: {
    fontSize: 16,
    color: COLORS.periwinkle[500],
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.neutral[900],
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.neutral[600],
  },
  form: {
    flex: 1,
    padding: 24,
  },
  field: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.neutral[900],
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.neutral[200],
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: COLORS.neutral[50],
  },
  textArea: {
    minHeight: 100,
    paddingTop: 16,
  },
  dateText: {
    fontSize: 16,
    color: COLORS.neutral[900],
  },
  pickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 20,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  pickerAction: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  pickerActionCancel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.neutral[500],
  },
  pickerActionDone: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary.main,
  },
  continueButton: {
    backgroundColor: COLORS.primary.main,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 40,
  },
  continueText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
