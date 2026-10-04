/**
 * Plan an event by describing it.
 *
 * WHY THIS SCREEN EXISTS
 *   `/api/ai/chat` had exactly one consumer, on the web. `packages/core` had
 *   no AI resource at all, so this app could not reach the planner even though
 *   it is the feature a paid tier is being built to gate. Selling a
 *   subscription whose headline feature one platform cannot use is a scoping
 *   defect, not a billing one, so the gap is closed before the paywall.
 *
 * WHAT IT HANDS FORWARD
 *   The planner returns a cumulative `extracted` block every turn. On accept,
 *   the fields the wizard's next screen actually binds to are pushed as route
 *   params, so the user does not retype what they already said. The web
 *   handler dropped `eventDate` and `eventTime` for as long as it existed
 *   (src/components/EventCreation.tsx:665-673 records why); both are carried
 *   here.
 *
 * STATE IS THE TRANSCRIPT
 *   The endpoint is stateless and re-reads the whole conversation each turn,
 *   so the transcript in component state IS the session. It is deliberately
 *   not persisted: a half-finished planning chat restored days later would
 *   resume against a reference date that has moved, and every relative date in
 *   it ("next Saturday") would silently mean something else.
 */

import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import type { ChatMessage, ExtractedEventData } from '@partyhause/core';
import type { PaywallReason } from '@partyhause/core/contracts';
import { paywallCopy, MAX_CHAT_MESSAGE_CHARS } from '@partyhause/core';
import { api } from '@/lib/client';
import { COLORS } from '@/constants/theme';

/** docs/BRAND.md section 4. coral-700 carries white text at 5.86:1. */
const BRAND = {
  coralButton: '#C02A16',
  coralText: '#972317',
  ink: '#26201D',
  paper: '#FBFAF9',
  muted: '#6A5E58',
  hairline: '#EBE7E5',
  bubble: 'rgba(255, 82, 51, 0.08)',
};

const WELCOME =
  "Tell me about your event and I'll set it up. What are you planning, roughly when, and about how many people?";

/** Template ids the wizard's next screen understands (create/index.tsx). */
const WIZARD_TEMPLATES = new Set([
  'birthday',
  'kids-birthday',
  'wedding',
  'product-launch',
  'fundraiser',
  'festival',
  'conference',
  'corporate',
  'travel',
  'block-party',
  'class',
  'hackathon',
]);

/**
 * Map a planner template id onto one the wizard can render.
 *
 * The planner's vocabulary (server/lib/event-extraction.ts:46) and the
 * wizard's TEMPLATES array are not the same list: the planner knows `workshop`
 * and the wizard calls it `class`. Handing over an id the wizard cannot find
 * makes `TEMPLATES.find` return undefined and the details step renders empty,
 * which reads as a broken screen rather than an unmatched template.
 *
 * @param templateId What the planner chose.
 * @returns A wizard id, or null when nothing matches and the user should pick.
 */
function toWizardTemplate(templateId: string | null | undefined): string | null {
  if (!templateId) return null;
  if (WIZARD_TEMPLATES.has(templateId)) return templateId;
  if (templateId === 'workshop') return 'class';
  return null;
}

/**
 * Combine the planner's date and time into an ISO instant.
 *
 * `eventDate` is `YYYY-MM-DD` and `eventTime` is 24-hour `HH:MM`, both already
 * resolved from natural language server-side. Anchored in UTC so the value the
 * user reads back is the one they said, rather than drifting by the device
 * offset.
 *
 * @returns An ISO string, or null when there is no date to anchor to.
 */
function toIsoStart(date?: string | null, time?: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const clock = time && /^\d{1,2}:\d{2}$/.test(time) ? time : '18:00';
  const [hours, minutes] = clock.split(':');
  return `${date}T${hours.padStart(2, '0')}:${minutes}:00.000Z`;
}

/** One line of the understood-so-far summary, omitted when unknown. */
function summaryLines(extracted: ExtractedEventData | null): string[] {
  if (!extracted) return [];
  const lines: string[] = [];
  if (extracted.eventName) lines.push(`Name: ${extracted.eventName}`);
  if (extracted.eventDate) {
    lines.push(`When: ${extracted.eventDate}${extracted.eventTime ? ` at ${extracted.eventTime}` : ''}`);
  }
  if (extracted.location) lines.push(`Where: ${extracted.location}`);
  if (typeof extracted.expectedGuests === 'number') {
    lines.push(`Guests: ${extracted.expectedGuests}`);
  }
  if (typeof extracted.budget === 'number') lines.push(`Budget: $${extracted.budget}`);
  if (extracted.theme) lines.push(`Theme: ${extracted.theme}`);
  return lines;
}

export default function PlanWithAiScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: WELCOME },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The server refused a turn for payment. Not an error; a next step. */
  const [quotaSpent, setQuotaSpent] = useState<PaywallReason | null | false>(false);
  const [startingTrial, setStartingTrial] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedEventData | null>(null);

  const send = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || sending) return;

    // Optimistic: the user's own words appear immediately. The transcript sent
    // to the server is this same array, because the endpoint is stateless and
    // reads the whole conversation.
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    setError(null);

    // The resource trims to the newest 40 turns before sending; no need to
    // bound the array here as well.
    const { data, error: failure } = await api.ai.chat(next);
    setSending(false);

    if (failure || !data) {
      // Roll the optimistic turn back so the transcript the user sees is the
      // one the server has. Leaving it would send the same message twice on
      // the next attempt.
      setMessages(messages);
      setInput(text);

      // 402 is the wall, not a failure. The route answers PAYMENT_REQUIRED
      // once the three free turns are spent. Reporting "the planner could not
      // reply" would be untrue and would give the user nothing to do.
      if (failure?.status === 402) {
        setQuotaSpent((failure as { paywall?: { reason?: PaywallReason } })?.paywall?.reason ?? null);
        setError(null);
        return;
      }

      setError(
        failure?.status === 429
          ? 'That is a lot of planning at once. Give it a minute and try again.'
          : failure?.message ?? 'The planner could not reply. Try again.',
      );
      return;
    }

    setMessages([...next, { role: 'assistant', content: data.reply }]);
    setExtracted(data.extracted);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [input, sending, messages]);

  /**
   * Start the trial from the wall, then carry on in place.
   *
   * iOS will eventually route this through StoreKit, which Apple requires for
   * digital goods. It does not yet: there is no App Store Connect record and
   * no product id, so this calls the same endpoint the web does. That is the
   * honest interim, and it is wrong to ship to the App Store. IOS-PAY-01 in
   * docs/mobile-ios-launch/ is the gate; this button must be behind StoreKit
   * before the first submission, not before the first build.
   */
  const startTrial = async () => {
    setStartingTrial(true);
    const { error: failure } = await api.billing.startTrial();
    setStartingTrial(false);

    if (failure) {
      setError(
        failure.status === 409
          ? 'This account has already used its trial. Manage it in Settings.'
          : 'Could not start the trial. You can still enter the details yourself.',
      );
      return;
    }

    setQuotaSpent(false);
    setError(null);
  };

  const accept = useCallback(() => {
    if (!extracted) return;
    const template = toWizardTemplate(extracted.templateId);
    const startDate = toIsoStart(extracted.eventDate, extracted.eventTime);

    router.push({
      // Without a template the wizard cannot render its details step, so the
      // user is returned to the picker with everything else preserved rather
      // than dropped into an empty screen.
      pathname: template ? '/events/create/basics' : '/events/create',
      params: {
        ...(template ? { template } : {}),
        ...(extracted.eventName ? { title: extracted.eventName } : {}),
        ...(extracted.description ? { description: extracted.description } : {}),
        ...(extracted.location ? { location: extracted.location } : {}),
        ...(startDate ? { startDate } : {}),
      },
    });
  }, [extracted, router]);

  const lines = summaryLines(extracted);
  const canAccept = extracted !== null && lines.length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((message, index) => (
          <View
            key={`${index}-${message.role}`}
            style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.aiBubble]}
          >
            <Text style={message.role === 'user' ? styles.userText : styles.aiText}>
              {message.content}
            </Text>
          </View>
        ))}

        {sending ? (
          <View style={[styles.bubble, styles.aiBubble]}>
            <ActivityIndicator size="small" color={BRAND.muted} />
          </View>
        ) : null}

        {lines.length > 0 ? (
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>So far</Text>
            {lines.map((line) => (
              <Text key={line} style={styles.summaryLine}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {canAccept ? (
        <TouchableOpacity style={styles.accept} onPress={accept} accessibilityRole="button">
          <Text style={styles.acceptText}>Use these details</Text>
        </TouchableOpacity>
      ) : null}

      {/* The wall, in place of the composer.
          Leaving the input live under a wall invites the user to type a
          message that will be refused, which reads as a broken product rather
          than as a limit. */}
      {quotaSpent !== false ? (
        <View style={styles.wall}>
          <Text style={styles.wallTitle}>{paywallCopy(quotaSpent).title}</Text>
          <Text style={styles.wallBody}>{paywallCopy(quotaSpent).body}</Text>
          <TouchableOpacity
            style={[styles.accept, startingTrial && styles.disabled]}
            onPress={() => void startTrial()}
            disabled={startingTrial}
            accessibilityRole="button"
          >
            <Text style={styles.acceptText}>
              {startingTrial ? 'Starting...' : paywallCopy(quotaSpent).cta}
            </Text>
          </TouchableOpacity>
          {/* Every wall here has an exit. The planner accelerates a wizard
              that still works unaided, and a wall with no way past it turns a
              user who was not paying today into a user who leaves. */}
          <TouchableOpacity
            onPress={() => router.push('/events/create')}
            accessibilityRole="button"
            style={styles.wallDismiss}
          >
            <Text style={styles.wallDismissText}>{paywallCopy(quotaSpent).dismiss}</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Describe your event"
          placeholderTextColor={BRAND.muted}
          maxLength={MAX_CHAT_MESSAGE_CHARS}
          editable={!sending}
          multiline
          accessibilityLabel="Describe your event"
        />
        <TouchableOpacity
          style={[styles.send, (sending || input.trim().length === 0) && styles.disabled]}
          onPress={() => void send()}
          disabled={sending || input.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
      )}

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BRAND.paper },
  wall: { borderTopWidth: 1, borderTopColor: BRAND.hairline, padding: 16, backgroundColor: BRAND.bubble },
  wallTitle: { fontSize: 16, fontWeight: '700', color: BRAND.ink, marginBottom: 4 },
  wallBody: { fontSize: 14, color: BRAND.muted, lineHeight: 20, marginBottom: 12 },
  wallDismiss: { paddingVertical: 12, alignItems: 'center' },
  wallDismissText: { fontSize: 15, color: BRAND.muted, fontWeight: '600' },
  transcript: { flex: 1 },
  transcriptContent: { padding: 16, paddingBottom: 8 },
  bubble: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10, maxWidth: '88%' },
  aiBubble: { backgroundColor: BRAND.bubble, alignSelf: 'flex-start' },
  userBubble: { backgroundColor: BRAND.coralButton, alignSelf: 'flex-end' },
  aiText: { fontSize: 15, color: BRAND.ink, lineHeight: 21 },
  userText: { fontSize: 15, color: '#FFFFFF', lineHeight: 21 },
  summary: {
    borderWidth: 1,
    borderColor: BRAND.hairline,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 14,
    marginTop: 6,
  },
  summaryTitle: { fontSize: 13, fontWeight: '700', color: BRAND.muted, marginBottom: 6 },
  summaryLine: { fontSize: 14, color: BRAND.ink, lineHeight: 20 },
  error: { fontSize: 14, color: BRAND.coralText, paddingHorizontal: 16, paddingBottom: 8 },
  accept: {
    backgroundColor: BRAND.coralButton,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  acceptText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: BRAND.hairline,
    backgroundColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: BRAND.hairline,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: BRAND.ink,
    maxHeight: 120,
  },
  send: {
    backgroundColor: BRAND.coralButton,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sendText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
