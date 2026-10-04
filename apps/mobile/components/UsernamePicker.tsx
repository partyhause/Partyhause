/**
 * The username field for iOS: input, live availability, suggestions, submit.
 *
 * Rendered by the onboarding gate in `app/(tabs)/index.tsx` and by the change
 * control in `app/settings/profile.tsx`. One component for both, because they
 * are the same decision at two moments, and this repository already carries the
 * cost of the same contract implemented twice.
 *
 * THE SERVER OWNS THE POLICY
 *   No copy of `server/lib/username.ts` lives here. The availability endpoint
 *   returns a displayable sentence for every refusal, so the field shows the
 *   server's own message. The only local rules are the alphabet filter applied
 *   while typing and a length floor that stops a request being made for a value
 *   that cannot be valid. Limits come from the server payload rather than being
 *   hardcoded.
 *
 * COLOUR
 *   Solid fill is `coral-700 #C02A16`, not `coral-500 #FF5233`. docs/BRAND.md
 *   section 4.1 measures white on coral-500 at 3.23:1, which fails WCAG 2.1 AA
 *   for body text, and records that the app ships that pair today. coral-700
 *   measures 5.86:1. New surfaces do not inherit a known defect.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { OnboardingState } from '@partyhause/core';
import { api } from '@/lib/client';
import { COLORS } from '@/constants/theme';

/** docs/BRAND.md section 4. */
const BRAND = {
  coral: '#FF5233',
  coralButton: '#C02A16',
  coralText: '#972317',
  ink: '#26201D',
  paper: '#FBFAF9',
  muted: '#6A5E58',
  hairline: '#EBE7E5',
  success: '#0B835B',
};

/** Wait after the last keystroke before asking the server. */
const AVAILABILITY_DEBOUNCE_MS = 400;

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; username: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string };

interface UsernamePickerProps {
  state: OnboardingState;
  heading: string;
  description: string;
  submitLabel: string;
  /** Rendered only when supplied. The caller decides using `state.skippable`. */
  onSkip?: () => void;
  onDone: () => void;
}

/**
 * Drop characters the server refuses, as the user types.
 *
 * Filtering rather than warning, for this one class of input: a space in a
 * handle field is a slip, not an intention. Every other rule produces a
 * sentence instead, because those reflect a real choice.
 *
 * @param raw Value from the change event.
 * @param maxLength Server-supplied bound.
 * @returns The value to put back in the field.
 */
function sanitizeTyping(raw: string, maxLength: number): string {
  return raw.replace(/[^A-Za-z0-9_]/g, '').slice(0, maxLength);
}

export function UsernamePicker({
  state,
  heading,
  description,
  submitLabel,
  onSkip,
  onDone,
}: UsernamePickerProps) {
  // Only seed the field when the handle was actually chosen. Pre-filling the
  // assigned u_<base36> value would put the thing this screen replaces into
  // the input.
  const [value, setValue] = useState(state.has_chosen_username ? state.username : '');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Monotonic request id. A response is applied only when it is still the
  // newest, so a slow answer for an earlier keystroke cannot describe a value
  // the field no longer holds.
  const sequence = useRef(0);

  const currentUsername = state.has_chosen_username ? state.username : null;
  const { min_length: minLength, max_length: maxLength } = state.limits;

  useEffect(() => {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      setStatus({ kind: 'idle' });
      return;
    }
    if (trimmed.length < minLength) {
      setStatus({ kind: 'unavailable', message: `Usernames need at least ${minLength} characters.` });
      return;
    }
    if (currentUsername && trimmed.toLowerCase() === currentUsername.toLowerCase()) {
      setStatus({ kind: 'available', username: trimmed });
      return;
    }

    setStatus({ kind: 'checking' });
    const id = ++sequence.current;

    const timer = setTimeout(async () => {
      const { data, error } = await api.users.checkUsername(trimmed);
      if (id !== sequence.current) return;

      if (error || !data) {
        setStatus({
          kind: 'error',
          message:
            error?.status === 429
              ? 'Too many checks. Pause for a moment and try again.'
              : 'Could not check that username. Try again.',
        });
        return;
      }

      setStatus(
        data.available
          ? { kind: 'available', username: data.username }
          : { kind: 'unavailable', message: data.message ?? 'That username is not available.' },
      );
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value, minLength, currentUsername]);

  const cooldownNotice = (() => {
    if (!state.can_change_at) return null;
    const unlocksAt = new Date(state.can_change_at);
    if (Number.isNaN(unlocksAt.getTime()) || unlocksAt.getTime() <= Date.now()) return null;
    return `You can change your username again on ${unlocksAt.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}.`;
  })();

  const locked = cooldownNotice !== null;
  const canSubmit = status.kind === 'available' && !submitting && !locked;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const { data, error } = await api.users.setUsername(value.trim());
    setSubmitting(false);

    if (error || !data) {
      setSubmitError(error?.message ?? 'Could not save that username. Try again.');
      return;
    }
    onDone();
  }, [canSubmit, value, onDone]);

  const dismiss = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    const { error } = await api.users.skipOnboarding();
    setSubmitting(false);

    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSkip?.();
  }, [onSkip]);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.description}>{description}</Text>

      {state.username_is_generated ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            You are currently <Text style={styles.mono}>@{state.username}</Text>, which was assigned
            automatically.
          </Text>
        </View>
      ) : null}

      <Text style={styles.label}>Username</Text>
      <View style={styles.inputRow}>
        <Text style={styles.at}>@</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={(next) => setValue(sanitizeTyping(next, maxLength))}
          placeholder="yourname"
          placeholderTextColor={BRAND.muted}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textContentType="username"
          maxLength={maxLength}
          editable={!submitting && !locked}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          accessibilityLabel="Username"
        />
        {status.kind === 'checking' ? (
          <ActivityIndicator size="small" color={BRAND.muted} />
        ) : null}
      </View>

      {/*
        accessibilityLiveRegion so VoiceOver announces the verdict without the
        user navigating back to the field to discover it changed.
      */}
      <Text
        style={[
          styles.status,
          status.kind === 'available' ? styles.statusOk : null,
          status.kind === 'unavailable' || status.kind === 'error' ? styles.statusBad : null,
        ]}
        accessibilityLiveRegion="polite"
      >
        {status.kind === 'checking' ? 'Checking availability...' : null}
        {status.kind === 'available' ? `@${status.username} is available.` : null}
        {status.kind === 'unavailable' || status.kind === 'error' ? status.message : null}
        {status.kind === 'idle' ? ' ' : null}
      </Text>

      {state.suggestions.length > 0 && !state.has_chosen_username ? (
        <View style={styles.suggestions}>
          <Text style={styles.label}>Suggestions</Text>
          <View style={styles.chipRow}>
            {state.suggestions.map((suggestion) => (
              <TouchableOpacity
                key={suggestion}
                style={styles.chip}
                onPress={() => setValue(suggestion)}
                disabled={submitting || locked}
              >
                <Text style={styles.chipText}>@{suggestion}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {cooldownNotice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{cooldownNotice}</Text>
        </View>
      ) : (
        <Text style={styles.hint}>
          Letters, numbers and underscores. {minLength} to {maxLength} characters. You can change it
          again after {state.limits.cooldown_days} days.
        </Text>
      )}

      {submitError ? <Text style={styles.error}>{submitError}</Text> : null}

      <TouchableOpacity
        style={[styles.primary, !canSubmit && styles.disabled]}
        onPress={() => void submit()}
        disabled={!canSubmit}
        accessibilityRole="button"
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryText}>{submitLabel}</Text>
        )}
      </TouchableOpacity>

      {onSkip ? (
        <TouchableOpacity
          style={styles.secondary}
          onPress={() => void dismiss()}
          disabled={submitting}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Not now</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  heading: { fontSize: 24, fontWeight: '700', color: BRAND.ink },
  description: { fontSize: 15, color: BRAND.muted, marginTop: 8, lineHeight: 21 },
  notice: { backgroundColor: 'rgba(255, 82, 51, 0.08)', borderRadius: 10, padding: 12, marginTop: 16 },
  noticeText: { fontSize: 13, color: BRAND.ink, lineHeight: 19 },
  mono: { fontFamily: 'Courier', fontWeight: '600' },
  label: { fontSize: 14, fontWeight: '600', color: BRAND.ink, marginTop: 20 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BRAND.hairline,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    marginTop: 8,
  },
  at: { fontSize: 16, color: BRAND.muted, marginRight: 2 },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: BRAND.ink,
    fontFamily: 'Courier',
  },
  status: { fontSize: 13, color: BRAND.muted, marginTop: 8, minHeight: 18 },
  statusOk: { color: BRAND.success },
  statusBad: { color: BRAND.coralText },
  suggestions: { marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    borderWidth: 1,
    borderColor: BRAND.hairline,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#FFFFFF',
  },
  chipText: { fontSize: 13, color: BRAND.ink, fontFamily: 'Courier' },
  hint: { fontSize: 12, color: BRAND.muted, marginTop: 16, lineHeight: 18 },
  error: { fontSize: 14, color: BRAND.coralText, marginTop: 12, lineHeight: 20 },
  primary: {
    backgroundColor: BRAND.coralButton,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  secondary: { paddingVertical: 14, alignItems: 'center' },
  secondaryText: { fontSize: 15, color: BRAND.muted },
});
