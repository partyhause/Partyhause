// Express route: /api/onboarding
//
// The five-screen funnel's state and its answers. The state machine itself is
// server/lib/onboarding-flow.ts and is pure; this router is the I/O around it.

import { Router } from 'express';
import type { Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import type { AuthenticatedRequest } from '../middleware/auth';
import { onboardingAnswers } from '@partyhause/core/contracts/billing';
import { validated } from '../lib/validate';
import { loadEntitlement } from './billing';
import {
  NO_ANSWERS,
  ONBOARDING_SCHEMA_VERSION,
  computeOnboardingFlow,
  type OnboardingAnswerFacts,
} from '../lib/onboarding-flow';

const router = Router();

/** The columns the flow and the clients read. */
const ANSWER_SELECT = {
  schema_version: true,
  organizer_type: true,
  events_per_year: true,
  typical_guest_count: true,
  ai_before: true,
  ai_during: true,
  ai_after: true,
  autonomy_level: true,
  agentic_wants: true,
  biggest_pain: true,
  completed_at: true,
} as const;

type AnswerRow = OnboardingAnswerFacts & { schema_version: string };

/** Serialise a row for the wire. Dates become ISO; absence becomes null. */
function serialiseAnswers(row: AnswerRow | null) {
  const facts = row ?? { ...NO_ANSWERS, schema_version: ONBOARDING_SCHEMA_VERSION };
  return {
    schema_version: facts.schema_version,
    organizer_type: facts.organizer_type,
    events_per_year: facts.events_per_year,
    typical_guest_count: facts.typical_guest_count,
    ai_before: facts.ai_before,
    ai_during: facts.ai_during,
    ai_after: facts.ai_after,
    autonomy_level: facts.autonomy_level,
    agentic_wants: facts.agentic_wants,
    biggest_pain: facts.biggest_pain,
    completed_at: facts.completed_at ? facts.completed_at.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/onboarding
//
// Everything a client needs to render the funnel: which step, what has been
// answered, and whether the wall is what is in the way. One call, because a
// client assembling this from three endpoints would have three chances to
// assemble it differently from the other client.
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const [row, entitlement] = await Promise.all([
      prisma.onboardingResponse.findUnique({ where: { user_id: userId }, select: ANSWER_SELECT }),
      loadEntitlement(userId),
    ]);

    res.json({
      flow: computeOnboardingFlow(row ?? NO_ANSWERS, entitlement),
      answers: serialiseAnswers(row as AnswerRow | null),
      entitlement,
    });
  } catch (err) {
    console.error('[Onboarding] read error:', err);
    res.status(500).json({ error: 'Failed to load onboarding state' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/onboarding
//
// Save whatever has been answered so far. Called per screen, not once at the
// end: a user who leaves mid-flow has still told us something, and the people
// who stop answering are the most interesting sample there is.
// ---------------------------------------------------------------------------
router.patch('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const patch = validated(res, onboardingAnswers, req.body);
    if (!patch) return;

    const { completed, ...answers } = patch;

    // Only keys actually present are written, so saving screen 3 cannot blank
    // screen 2. An explicit empty array IS a meaningful answer ("none of
    // these"), which is why absence rather than emptiness is the test.
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answers)) {
      if (value !== undefined) data[key] = value;
    }

    // `completed` is one-way. Re-submitting the last screen must not move the
    // timestamp, because it marks when the funnel was first finished and
    // anything reading it for cohort analysis would see the user drift
    // forward every time they revisited.
    const existing = await prisma.onboardingResponse.findUnique({
      where: { user_id: userId },
      select: { completed_at: true },
    });
    if (completed === true && !existing?.completed_at) {
      data.completed_at = new Date();
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No answers provided' });
    }

    const row = await prisma.onboardingResponse.upsert({
      where: { user_id: userId },
      update: data,
      create: {
        user_id: userId,
        schema_version: ONBOARDING_SCHEMA_VERSION,
        ...data,
      },
      select: ANSWER_SELECT,
    });

    const entitlement = await loadEntitlement(userId);
    res.json({
      flow: computeOnboardingFlow(row as AnswerRow, entitlement),
      answers: serialiseAnswers(row as AnswerRow),
      entitlement,
    });
  } catch (err) {
    console.error('[Onboarding] write error:', err);
    res.status(500).json({ error: 'Failed to save your answers' });
  }
});

export default router;
