/**
 * The conversational event planner, `/api/ai/chat`.
 *
 * WHY THIS RESOURCE DID NOT EXIST
 *   `packages/core` covered 77 endpoints and this was not one of them, so the
 *   iOS app had no way to reach the planner. `docs/SHARED_API_CLIENT.md` records
 *   the row as `| /api/ai | yes | none | none | none |`: a server surface with
 *   no client on any platform but the web.
 *
 *   That mattered once the planner became the feature a paid tier gates. A
 *   subscription sold on iOS whose headline feature the iOS app cannot use is
 *   not a billing defect, it is a scoping one, so the gap is closed before the
 *   paywall is built on top of it.
 *
 * WHAT IS DELIBERATELY ABSENT
 *   `POST /api/ai/extract-event-details` is not wrapped. It has had zero
 *   callers on any platform since it was written, and `runChatTurn` does not
 *   use it either. Adding a client method for it would create the first caller
 *   of a dead endpoint rather than remove one.
 */

import type { Transport, ApiResponse } from '../http/transport';
import type { ChatMessage, ChatTurnResult } from '../types';

/**
 * Bounds the server enforces in `sanitizeMessages`
 * (server/lib/event-chat.ts:301-314). Mirrored so a client can trim before
 * sending rather than discover the limit as a 400.
 */
export const MAX_CHAT_MESSAGES = 40;
export const MAX_CHAT_MESSAGE_CHARS = 4000;

export interface AiResource {
  /**
   * Take one conversational turn.
   *
   * @param messages The FULL transcript, oldest first, last entry from the
   *        user. The endpoint is stateless: it re-reads the whole conversation
   *        every turn, so sending only the newest message loses all context.
   *        Longer transcripts are trimmed to the most recent
   *        {@link MAX_CHAT_MESSAGES} before sending, keeping the newest.
   * @returns `{ reply, extracted, complete, source }`. `extracted` is
   *          cumulative and should replace a client's copy wholesale rather
   *          than be merged, or a detail the user retracted survives locally.
   *          `source` distinguishes a real model answer from the free
   *          deterministic fallback, and is what metering reads.
   *
   *          A 429 means the per-user AI limiter tripped: 30 requests per 5
   *          minutes (server/routes/ai.ts:22-34).
   */
  chat(messages: ChatMessage[]): Promise<ApiResponse<ChatTurnResult>>;
}

/**
 * Trim a transcript to what the server will accept.
 *
 * Keeps the NEWEST messages, because the planner's own rule is that the latest
 * statement wins on any contradiction, so dropping recent turns would discard
 * the corrections rather than the stale detail.
 *
 * The result may still begin with an assistant message, which is fine: the
 * server only requires that the LAST entry is from the user.
 *
 * @param messages Full transcript.
 * @returns At most {@link MAX_CHAT_MESSAGES} entries, each truncated to
 *          {@link MAX_CHAT_MESSAGE_CHARS}.
 *
 * Complexity: O(n) in the transcript length. No I/O.
 */
export function trimTranscript(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages.length > MAX_CHAT_MESSAGES
    ? messages.slice(messages.length - MAX_CHAT_MESSAGES)
    : messages;
  return recent.map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_CHAT_MESSAGE_CHARS),
  }));
}

export function createAiResource(t: Transport): AiResource {
  return {
    chat: async (messages) => {
      // The route answers `{ success, data }`, so the payload is one level in.
      // Unwrapped here rather than at each call site, matching how every other
      // enveloped resource in this package behaves.
      const result = await t.request<{ success?: boolean; data?: ChatTurnResult }>(
        '/api/ai/chat',
        { method: 'POST', body: { messages: trimTranscript(messages) } },
      );
      if (result.error) return { data: null, error: result.error };
      if (!result.data?.data) {
        return {
          data: null,
          error: { message: 'The planner returned no result', status: 200 },
        };
      }
      return { data: result.data.data, error: null };
    },
  };
}
