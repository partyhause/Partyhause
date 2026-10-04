/**
 * The API contract, and the single source of truth for it.
 *
 * HOW TO USE THIS
 *   Server:  import { guestPatch, parseOrThrow } from '@partyhause/core/contracts'
 *            and parse at the trust boundary.
 *   Clients: import type { Guest } from '@partyhause/core'
 *            and never touch this subpath.
 *
 *   That split is load-bearing, not stylistic. `packages/core/src/types.ts`
 *   re-exports the inferred types with `export type`, which TypeScript erases,
 *   so importing a type costs a client nothing at runtime and no client bundle
 *   gains zod. It also keeps the two zod majors apart: the root resolves
 *   3.25.76, and apps/mobile/node_modules holds 4.5.4 via
 *   eslint-plugin-react-hooks. Only the server ever loads a schema, so the
 *   majors never have to agree.
 *
 * WHY SCHEMAS RATHER THAN TYPES
 *   A type describes what the code believes. A schema decides what the server
 *   accepts. When those two drift the database casts the deciding vote, and it
 *   votes with a 500. Three of those are live today, all in one file
 *   (`server/routes/guests.ts`), all because a hand-rolled check is looser
 *   than the CHECK constraint it writes through. Every schema here is
 *   transcribed from the constraint, with the migration cited.
 *
 * WHAT IS NOT HERE YET
 *   This is the foundation, not the whole surface. Guests, events, users,
 *   polls, notifications and timeline blocks are covered because each was
 *   duplicated at least four times and each carried a measured defect.
 *   PartyBoard, cost-split, connections, invites, email logs and the
 *   `/api/mvp` camelCase DTOs still have hand-written types elsewhere.
 *   `server/lib/mvp-contract.ts` remains the authority for `/api/mvp`; it
 *   already does this job well for that surface and is the pattern this
 *   generalises.
 *
 *   `./ai` was added when the conversational planner was brought to mobile.
 *   Its shapes are consumed by both clients rather than retyped on each, which
 *   is what the web client had been doing.
 */

import type { z } from 'zod';

export * from './primitives';
export * from './guest';
export * from './event';
export * from './social';
export * from './user';
export * from './ai';
export * from './billing';

/** A failed parse, shaped for an HTTP 400 body. */
export interface ContractViolation {
  /** Dotted path to the offending field, or `''` for the object itself. */
  path: string;
  message: string;
}

/**
 * The outcome of validating untrusted input. Never throws.
 *
 * DELIBERATELY FLAT, NOT A DISCRIMINATED UNION
 *   `{ok:true,value} | {ok:false,violations}` is the tidier shape and was
 *   written first. It does not work here: tsconfig.server.json and
 *   tsconfig.app.json both set `strict: false`, and without strictNullChecks
 *   TypeScript will not narrow a boolean discriminant, so every read of
 *   `violations` after an `if (!result.ok)` guard was a compile error. The
 *   same constraint shaped `UsernameVerdict` in server/lib/username.ts; the
 *   two are consistent on purpose.
 *
 *   `value` is null on failure and `violations` is empty on success, so a
 *   misuse yields a value the next layer refuses rather than `undefined`
 *   flowing onward.
 */
export interface ContractResult<T> {
  ok: boolean;
  value: T | null;
  violations: ContractViolation[];
}

/**
 * Validate untrusted input against a schema.
 *
 * Returns rather than throws, because a malformed request body is an expected
 * condition at a public boundary and not an exceptional one. Exceptions as
 * control flow for routine input is what NASA's Power of 10 rule 1 forbids,
 * and it is also how a validation failure becomes a 500 instead of a 400.
 *
 * @param schema Any schema exported from this module.
 * @param input The untrusted value, normally `req.body` or `req.query`.
 * @returns The parsed value, or every violation found. zod collects all
 *          issues rather than stopping at the first, so a caller fixing a
 *          form is told everything that is wrong in one round trip.
 *
 * Complexity: O(n) in the size of the input. No I/O.
 */
export function parseContract<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): ContractResult<z.infer<S>> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data, violations: [] };
  }
  return {
    ok: false,
    value: null,
    violations: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

/**
 * Render violations as one human-readable sentence.
 *
 * Used for the `error` string in a 400 body, so the existing clients, which
 * all read `body.error` as a string, keep working unchanged. The structured
 * list travels alongside it under `violations` for anything that wants to
 * highlight individual fields.
 *
 * @param violations A non-empty list from {@link parseContract}.
 * @returns A single sentence naming each offending field.
 */
export function describeViolations(violations: ContractViolation[]): string {
  if (violations.length === 0) return 'Invalid request';
  return violations
    .map((violation) => (violation.path ? `${violation.path}: ${violation.message}` : violation.message))
    .join('; ');
}
