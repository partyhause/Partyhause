/**
 * Claiming a free model turn, atomically.
 *
 * THE RACE THIS CLOSES
 *   The route used to read entitlement, await the model, then record usage.
 *   Two concurrent requests both read the pre-write count and both passed:
 *
 *     both read used = 2 of 3
 *     request A allowed: true
 *     request B allowed: true
 *     => 2 turns served from a quota of 1
 *
 *   The window was the whole model call, up to fifteen seconds, so it did not
 *   need a determined attacker. Two browser tabs, or a double-tapped send
 *   button, was enough.
 *
 * WHY A UNIQUE INDEX CANNOT FIX IT
 *   The invariant is "at most N rows for this user", not "at most one row for
 *   this key". There is no key to collide on, because every turn is a
 *   legitimately distinct row.
 *
 * AND WHY `INSERT ... SELECT ... WHERE (SELECT count(*)) < N` DOES NOT EITHER
 *   That was the first fix written here and it does not work. PostgreSQL
 *   defaults to READ COMMITTED, where each statement sees a snapshot taken at
 *   statement start, and concurrent uncommitted inserts are invisible to one
 *   another. Ten simultaneous claims against a quota of three all saw a count
 *   of zero and all inserted. Measured, not reasoned about:
 *
 *     10 concurrent claims, quota 3 -> granted: 10
 *
 *   The counting and the insert must therefore be serialised per user, which
 *   is what the transaction-scoped advisory lock below does. It is the same
 *   mechanism `server/lib/retention.ts:34` already uses to stop two replicas
 *   running one sweep, with a distinct namespace so the two cannot contend.
 *
 * WHY THE SEAT IS CLAIMED BEFORE THE MODEL RUNS
 *   Reserving first and releasing on failure is the only ordering that cannot
 *   overspend. Charging afterwards leaves the window open for the duration of
 *   the call, which is precisely where the race lived. The cost is that a
 *   crashed process can leak a reservation, which is one turn, recoverable by
 *   the user and invisible to the quota beyond that single row. Overspending
 *   is unbounded; leaking is bounded at one.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { FREE_AI_TURNS } from './entitlement';

/**
 * Advisory-lock namespace for AI quota claims.
 *
 * Two-integer form, so the namespace and the subject are separate. A distinct
 * constant from the retention sweeper's 7206091: sharing one would make every
 * quota claim in the system queue behind an hourly maintenance job.
 */
const QUOTA_LOCK_NAMESPACE = 7206092;

/** What a claim attempt produced. */
export interface QuotaClaim {
  /** True when a turn may proceed. */
  granted: boolean;
  /**
   * The reserved row, when one was inserted. Null for an entitled caller, who
   * consumes no quota, and null when the quota was exhausted.
   */
  reservationId: string | null;
  /** Billable turns used after this attempt. */
  used: number;
}

/**
 * Reserve one billable turn, or refuse.
 *
 * An entitled caller is granted without reserving: a subscriber has no quota
 * to consume, and recording one would make `ai.used` climb forever and
 * misreport every entitled account as over its limit the moment a trial ends.
 *
 * @param database Prisma client, injectable for tests.
 * @param userId The authenticated caller.
 * @param isEntitled Whether the paid feature set is open for this caller.
 * @returns Whether to proceed, and the reservation to settle afterwards.
 *
 * Complexity: one lock, one indexed count and one insert, inside a
 * transaction. The count is covered by `ai_usage (user_id, source)`.
 * Blocking I/O.
 */
export async function claimAiTurn(
  database: Pick<PrismaClient, '$transaction'>,
  userId: string,
  isEntitled: boolean,
): Promise<QuotaClaim> {
  if (isEntitled) {
    return { granted: true, reservationId: null, used: 0 };
  }

  return database.$transaction(async (tx) => {
    // Serialise claims for THIS user only. Transaction-scoped, so it is
    // released on commit or rollback without an unlock call that a crash could
    // skip. hashtext is stable within a database, which is all this needs:
    // a collision between two users would merely make them queue.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${QUOTA_LOCK_NAMESPACE}, hashtext(${userId}))
    `;

    const used = await tx.aiUsage.count({ where: { user_id: userId, source: 'llm' } });
    if (used >= FREE_AI_TURNS) {
      return { granted: false, reservationId: null, used };
    }

    // Provisionally 'llm'. The real engine is not known until the turn
    // returns, and settleAiTurn corrects it. Reserving as 'llm' is the safe
    // direction: it counts against the quota until proven otherwise, so a
    // crash between here and settlement costs the user one turn rather than
    // giving away an uncounted one.
    const reservation = await tx.aiUsage.create({
      data: { user_id: userId, source: 'llm' },
      select: { id: true },
    });

    return { granted: true, reservationId: reservation.id, used: used + 1 };
  });
}

/**
 * Settle a reservation once the turn is known to have succeeded or failed.
 *
 * @param database Prisma client.
 * @param claim The claim returned by {@link claimAiTurn}.
 * @param outcome `'llm'` or `'heuristic'` when the turn produced a reply,
 *        `'failed'` when it did not.
 *
 * A heuristic reply is corrected rather than deleted. It costs nothing to
 * serve, so it must not spend a turn, but it is worth keeping for
 * observability: the ratio of heuristic to llm answers is the only signal that
 * the model is unconfigured or timing out, and deleting the row destroys it.
 *
 * A failed turn releases the seat entirely. Charging for an answer the user
 * never received is the one outcome with no defence.
 */
export async function settleAiTurn(
  database: Pick<PrismaClient, 'aiUsage'>,
  claim: QuotaClaim,
  outcome: 'llm' | 'heuristic' | 'failed',
): Promise<void> {
  if (claim.reservationId === null) return;

  if (outcome === 'failed') {
    await database.aiUsage.delete({ where: { id: claim.reservationId } });
    return;
  }

  if (outcome === 'heuristic') {
    await database.aiUsage.update({
      where: { id: claim.reservationId },
      data: { source: 'heuristic' } satisfies Prisma.AiUsageUpdateInput,
    });
  }
}
