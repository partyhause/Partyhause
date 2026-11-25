/**
 * Recognise a database unique-constraint violation, and say which column broke.
 *
 * One helper because this decision was previously re-derived per route, and
 * the copies disagreed: some accepted only Prisma's `P2002`, some also
 * accepted the underlying PostgreSQL `23505` that a driver adapter surfaces
 * directly, and the divergence was invisible until a call site answered 500
 * for a conflict its neighbour answered 409. `verify_dependencies` cannot
 * catch this class; only a single definition can.
 *
 * Accepted shapes, all of which occur in this codebase:
 *   - `Prisma.PrismaClientKnownRequestError`: `{ code: 'P2002', meta: { target } }`
 *   - the pg driver adapter surfacing PostgreSQL's own `23505`
 *   - anything else carrying a string `code` property (defensive; see
 *     `errorCode`, which never throws on a non-object)
 *
 * The `target` half answers WHICH constraint fired. Prisma reports it as a
 * field-name list (`['username']`) or a single name, and omits it entirely
 * when the constraint is expressed only in SQL. An absent target is not a
 * refusal to answer: it is "cannot attribute", and the caller decides
 * whether that means yes (when the table has exactly one unique constraint,
 * as user_profiles does for usernames) or no.
 */

/** Either unique-violation code, from either layer that can raise it. */
const UNIQUE_VIOLATION_CODES: Record<string, true> = { P2002: true, '23505': true };

/** The `code` property of an error, or '' when the value has none. */
export function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code ?? '');
}

/**
 * True when the error is a unique-constraint violation on any column.
 *
 * @param error Whatever a Prisma query rejected with. Any value can be
 *   thrown, so non-objects are a plain false rather than an exception.
 */
export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) in UNIQUE_VIOLATION_CODES;
}

/**
 * True when the error is a unique violation on a constraint covering `field`.
 *
 * Field names are matched case-insensitively as substrings, because that is
 * how Prisma names compound constraints: `guests_event_id_user_id_key`
 * reports `target: ['event_id', 'user_id']`, and a caller asking about
 * `user_id` must match. A substring test also keeps composite targets
 * answerable without modelling every index.
 *
 * @param error The rejected query's error.
 * @param field A column name such as 'email' or 'username'. Matched against
 *   every entry of `meta.target` when Prisma supplies one.
 * @param untargetedCounts What an error with NO target means. `true` treats
 *   it as a match: the right default when the table's only unique columns are
 *   the ones being inserted, so a conflict it did not attribute is still a
 *   conflict on them. `false` is the conservative default for tables with
 *   several unique constraints, where a wrong attribution is worse than a
 *   500 the operator can see.
 * @returns Whether this error is a unique violation on `field`.
 */
export function isUniqueViolationOn(
  error: unknown,
  field: string,
  untargetedCounts = false,
): boolean {
  if (!isUniqueViolation(error)) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (target === undefined || target === null) return untargetedCounts;
  const fields = Array.isArray(target) ? target : [target];
  const wanted = field.toLowerCase();
  return fields.some((entry) => String(entry).toLowerCase().includes(wanted));
}
