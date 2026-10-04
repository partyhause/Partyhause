/**
 * The conversational event planner contract.
 *
 * WHY THIS EXISTS NOW
 *   `/api/ai/chat` has had exactly one consumer since it was written:
 *   `src/components/templates/AIEventAssistant.tsx`. `packages/core` had no AI
 *   resource at all, so the iOS app could not call it. That is a problem for a
 *   product decision already taken: the AI planner is the feature a paid tier
 *   gates, and selling a subscription whose headline feature one platform
 *   cannot reach is not a billing bug, it is a scoping one. The gap is closed
 *   before any paywall is built on top of it.
 *
 * WHY THE SHAPES ARE HERE RATHER THAN RETYPED ON MOBILE
 *   The web client mirrors `ChatTurnResult` by hand at
 *   `AIEventAssistant.tsx:62-68`, with a comment pointing at the server file it
 *   was copied from. That is the pattern this package exists to end. Both
 *   clients now infer from one schema, and the server's own types are the
 *   thing it was transcribed from.
 *
 * THE `source` FIELD IS LOAD-BEARING, NOT DIAGNOSTIC
 *   `runChatTurn` falls back to a deterministic chrono-node and lexicon
 *   extractor whenever the LLM is unconfigured, times out, or returns
 *   something that fails validation (server/lib/event-chat.ts:291-298). The
 *   user gets a reply either way and cannot tell the difference, so `source`
 *   is the only signal that separates a real model answer from a free local
 *   one. Metering must read it: charging a credit for a heuristic reply would
 *   bill for something the model never produced.
 */

import { z } from 'zod';

/**
 * Template identifiers the planner may select.
 *
 * Transcribed from `KNOWN_TEMPLATE_IDS` in server/lib/event-extraction.ts:46,
 * which is interpolated directly into the system prompt and used as the zod
 * enum the model's JSON is validated against. A client offering an id the
 * server does not know would silently fail validation server-side and fall
 * back to the heuristic path.
 */
export const eventTemplateId = z.enum([
  'birthday',
  'kids-birthday',
  'wedding',
  'conference',
  'product-launch',
  'fundraiser',
  'festival',
  'travel',
  'block-party',
  'workshop',
  'hackathon',
]);

/** One turn of the transcript. The conversation has no server-side state. */
export const chatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

/** Bounds enforced by `sanitizeMessages` (server/lib/event-chat.ts:301-314). */
export const MAX_CHAT_MESSAGES = 40;
export const MAX_CHAT_MESSAGE_CHARS = 4000;

/**
 * The `POST /api/ai/chat` body.
 *
 * The full transcript every turn, because the endpoint is stateless by design:
 * semantic state lives in the messages, not in a server session, which is what
 * lets the route scale horizontally (server/lib/event-chat.ts:15-17).
 *
 * The last message must be from the user. The server refuses otherwise with a
 * 400 rather than asking the model to reply to itself.
 */
export const chatTurnRequest = z.object({
  messages: z
    .array(
      chatMessage.extend({
        content: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_CHAT_MESSAGES)
    .refine((messages) => messages[messages.length - 1]?.role === 'user', {
      message: 'The last message must be from the user',
    }),
});

/**
 * Everything the planner has understood so far.
 *
 * Cumulative, not per-turn: it reflects the whole conversation after this
 * turn, with the newest correction winning. A client should replace its copy
 * wholesale each turn rather than merging, or a detail the user retracted
 * survives in the client and not on the server.
 */
export const extractedEventData = z.object({
  templateId: z.string(),
  eventName: z.string().nullish(),
  description: z.string(),
  /** `YYYY-MM-DD`. */
  eventDate: z.string().nullish(),
  /** `HH:MM`, 24 hour. */
  eventTime: z.string().nullish(),
  location: z.string().nullish(),
  expectedGuests: z.number().int().nullish(),
  /** USD. */
  budget: z.number().nullish(),
  theme: z.string().nullish(),
  specialRequests: z.string().nullish(),
  /** Template-specific answers, shape varies by `templateId`. */
  formData: z.record(z.unknown()),
  /** 0..1 certainty in `templateId`. Zero means "we do not know". */
  confidence: z.number().min(0).max(1),
  source: z.enum(['llm', 'heuristic']),
});

/** The `data` payload of a successful chat turn. */
export const chatTurnResult = z.object({
  /** Already filler-stripped and truncated to 1200 characters server-side. */
  reply: z.string(),
  extracted: extractedEventData,
  /** True once templateId, eventDate and expectedGuests are all known. */
  complete: z.boolean(),
  /**
   * Which engine produced this. Recomputed server-side rather than taken from
   * the model, and the field metering reads.
   */
  source: z.enum(['llm', 'heuristic']),
});

/** The full envelope: the route wraps its payload in `{ success, data }`. */
export const chatTurnResponse = z.object({
  success: z.boolean(),
  data: chatTurnResult,
});

export type EventTemplateId = z.infer<typeof eventTemplateId>;
export type ChatMessage = z.infer<typeof chatMessage>;
export type ChatTurnRequest = z.infer<typeof chatTurnRequest>;
export type ExtractedEventData = z.infer<typeof extractedEventData>;
export type ChatTurnResult = z.infer<typeof chatTurnResult>;
export type ChatTurnResponse = z.infer<typeof chatTurnResponse>;
