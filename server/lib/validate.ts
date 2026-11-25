/**
 * Request validation at the trust boundary, against the shared contract.
 *
 * WHAT THIS REPLACES
 *   135 hand-rolled `res.status(400)` guards across `server/routes/*.ts`, with
 *   no shared helper between them. They were not merely verbose; three of them
 *   were measurably looser than the CHECK constraint they wrote through, which
 *   turns a caller's mistake into a 500 that names nothing:
 *
 *     - `guests.ts:207` accepted rsvp_status `'confirmed'`. The constraint was
 *       narrowed to four values and VALIDATEd (20260906000000:118-119, :137).
 *     - `guests.ts:147` wrote `guest.email || ''`, and the normalize trigger
 *       derives `normalized_email` from it, which CHECK requires to be
 *       non-empty (:120-124, VALIDATEd at :138).
 *     - `guests.ts:274` set `checked_in` with no RSVP check, against CHECK
 *       `guests_check_in_requires_accepted_check` (:127-131, VALIDATEd :140).
 *
 *   A schema transcribed from the constraint cannot be looser than it.
 *
 * WHY NOT A GENERIC MIDDLEWARE FACTORY
 *   `validateBody(schema)` as Express middleware was the first design. It was
 *   dropped because it hides which schema guards which route from anyone
 *   reading the handler, and because these routes need the parsed value under
 *   a name they choose. An explicit call on the first line of the handler is
 *   one line longer and says what it does.
 *
 * THE ERROR SHAPE IS DELIBERATELY BACKWARD-COMPATIBLE
 *   Every existing client reads `body.error` as a string, including
 *   `src/lib/api-client.ts:163` and `packages/core/src/http/transport.ts:91`.
 *   So `error` stays a sentence. The structured list travels beside it under
 *   `violations`, which nothing reads yet and anything can start reading
 *   without a server change.
 */

import type { Response } from 'express';
import type { z } from 'zod';
import { describeViolations, parseContract } from '@partyhause/core/contracts';
import type { ContractViolation } from '@partyhause/core/contracts';

/** The 400 body this module emits. */
export interface ValidationErrorBody {
  /** A sentence. Existing clients render this directly. */
  error: string;
  /** Stable machine code, so a client can branch without parsing prose. */
  code: 'VALIDATION_FAILED';
  /** Per-field detail. Additive; no existing client reads it. */
  violations: ContractViolation[];
}

/**
 * Validate untrusted input, answering 400 and returning null when it fails.
 *
 * The null return is what lets a handler stay flat:
 *
 *   const body = validated(res, guestPatch, req.body);
 *   if (!body) return;
 *
 * rather than nesting the whole handler inside a success branch. The response
 * is already sent when null comes back, so the caller must return immediately
 * and must not write again.
 *
 * @param res The response to answer on failure. Written to only on failure.
 * @param schema Any schema from `@partyhause/core/contracts`.
 * @param input The untrusted value, normally `req.body` or `req.query`.
 * @returns The parsed, typed value, or null when a 400 has been sent.
 *
 * Complexity: O(n) in the size of the input. No I/O.
 */
export function validated<S extends z.ZodTypeAny>(
  res: Response,
  schema: S,
  input: unknown,
): z.infer<S> | null {
  const result = parseContract(schema, input);
  if (result.ok) return result.value;

  const body: ValidationErrorBody = {
    error: describeViolations(result.violations),
    code: 'VALIDATION_FAILED',
    violations: result.violations,
  };
  res.status(400).json(body);
  return null;
}
