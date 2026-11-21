// Express route: /api/ai
// Semantic event-detail extraction. The extraction engine lives in
// server/lib/event-extraction.ts: an env-gated LLM layer (Azure OpenAI or
// OpenAI) with a deterministic chrono-node + weighted-lexicon fallback that
// requires no external services. See that module for the full contract.

import { Router } from 'express';
import type { Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import type { AuthenticatedRequest } from '../middleware/auth';
import { extractEventDetails } from '../lib/event-extraction';
import { runChatTurn, sanitizeMessages, MAX_MESSAGES } from '../lib/event-chat';
import { prisma } from '../lib/prisma';
import { loadEntitlement } from './billing';
import { claimAiTurn, settleAiTurn } from '../lib/ai-quota';

const router = Router();

// Every request here can cost LLM tokens. Auth alone does not bound spend —
// one signed-in user in a loop would. 30 requests / 5 min per user keeps
// interactive planning fluid (~1 turn / 10s) while capping worst-case burn.
// Mounted AFTER requireAuth on each route so req.user is populated; keyed
// by user id, falling back to IP for defense in depth.
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) =>
    // See the note on emailLimiter in server/index.ts. `req.ip` alone lets an
    // IPv6 caller rotate through a /64 for a fresh bucket per request;
    // ipKeyGenerator collapses that to the prefix. Pre-existing here, surfaced
    // only when the server was finally run with NODE_ENV=development.
    (req as AuthenticatedRequest).user?.id ?? ipKeyGenerator(req.ip ?? '') ?? 'unknown',
  message: { error: 'Too many AI requests. Try again in a few minutes.' },
});

const MAX_INPUT_CHARS = 8000;

// ---------------------------------------------------------------------------
// POST /api/ai/chat — multi-turn conversational event planner.
// Body: { messages: Array<{ role: 'user' | 'assistant'; content: string }> }
// (full history, last message from the user). Stateless per request.
// Returns { reply, extracted, complete, source }.
// ---------------------------------------------------------------------------
router.post('/chat', requireAuth, aiLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messages = sanitizeMessages((req.body as { messages?: unknown })?.messages);
    if (!messages) {
      return res.status(400).json({
        error: `Provide { messages: [{role, content}...] } — 1..${MAX_MESSAGES} entries, last one from the user`,
      });
    }

    // ---------------------------------------------------------------------
    // The quota gate.
    //
    // Three free model turns per account, for the life of the account. The
    // count lives in `ai_usage` rather than a rate limiter because every
    // limiter in this API is express-rate-limit's in-memory store: per
    // replica, reset on deploy, and with maxReplicas 3 the real allowance is
    // up to triple the nominal one.
    //
    // The seat is CLAIMED BEFORE the model runs, in one atomic statement.
    // Reading the count, awaiting the model, then recording usage left the
    // whole call open as a race: two tabs both read the pre-write total and
    // both passed, serving two turns from a quota of one. Reserving first is
    // the only ordering that cannot overspend.
    //
    // 402 rather than 403. The request is well formed and the caller is
    // authenticated; what is missing is payment, which is what the status
    // means. A 403 is indistinguishable from an authorization failure and the
    // client renders the wrong screen.
    //
    // FAILING OPEN, NARROWLY
    //   If entitlement cannot be READ, the turn proceeds unmetered. A database
    //   blip must not lock a paying customer out of what they pay for, and the
    //   blast radius is a handful of free turns during an outage. The reverse
    //   default is an outage that arrives at support as a billing dispute.
    let entitlement = null;
    try {
      entitlement = await loadEntitlement(req.user!.id);
    } catch (error: unknown) {
      console.error('AI entitlement read failed, allowing the turn:', error);
    }

    let claim = null;
    if (entitlement) {
      claim = await claimAiTurn(prisma, req.user!.id, entitlement.is_entitled);
      if (!claim.granted) {
        return res.status(402).json({
          error: 'Your free turns are used up.',
          code: 'PAYMENT_REQUIRED',
          paywall: entitlement.paywall,
          ai: { ...entitlement.ai, used: claim.used, remaining: 0 },
        });
      }
    }

    let result;
    try {
      result = await runChatTurn(messages);
    } catch (error: unknown) {
      // Release the seat. Charging for an answer the user never received is
      // the one outcome with no defence.
      if (claim) await settleAiTurn(prisma, claim, 'failed').catch(() => undefined);
      throw error;
    }

    // Correct the provisional 'llm' reservation. runChatTurn falls back to a
    // deterministic extractor whenever the model is unconfigured, times out,
    // or returns something unparseable, and the user cannot tell. A heuristic
    // reply costs nothing to serve, so it must not spend a turn; the row is
    // kept rather than deleted because the heuristic-to-llm ratio is the only
    // signal that the model is failing.
    //
    // Best effort: a settlement failure must not break a turn the user already
    // received. The worst case is one turn counted as billable that was not.
    if (claim) {
      try {
        await settleAiTurn(prisma, claim, result.source);
      } catch (error: unknown) {
        console.error('AI usage settlement failed:', error);
      }
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error: unknown) {
    console.error('AI chat error:', error);
    return res.status(500).json({ error: 'Chat turn failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai/extract-event-details
// Body: { conversation: Array<{ role: string; content: string }> }
//   or  { text: string }
// ---------------------------------------------------------------------------
router.post(
  '/extract-event-details',
  requireAuth,
  aiLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { conversation, text } = req.body as {
        conversation?: Array<{ role?: unknown; content?: unknown }>;
        text?: unknown;
      };

      let userText = '';
      if (typeof text === 'string') {
        userText = text;
      } else if (Array.isArray(conversation) && conversation.length > 0) {
        userText = conversation
          .filter((msg) => msg?.role === 'user' && typeof msg.content === 'string')
          .map((msg) => msg.content as string)
          .join(' ');
      } else {
        return res.status(400).json({ error: 'Provide { text } or { conversation }' });
      }

      userText = userText.trim();
      if (!userText) {
        return res.status(400).json({ error: 'No user text found' });
      }
      if (userText.length > MAX_INPUT_CHARS) {
        userText = userText.slice(0, MAX_INPUT_CHARS);
      }

      const result = await extractEventDetails(userText);

      return res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      console.error('AI extraction error:', error);
      return res.status(500).json({
        error: 'Failed to extract event details',
      });
    }
  },
);

export default router;
