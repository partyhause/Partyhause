/**
 * Username policy for user-chosen profile handles.
 *
 * Pure module: no I/O, no Prisma, no Express. Every export is a total function
 * over its arguments, so the rules can be unit-tested exhaustively and mirrored
 * by both clients without a round trip. The server remains the authority; the
 * clients mirror these rules only to turn a network round trip into an
 * immediate message.
 *
 * THE DATABASE IS THE AUTHORITY ON SHAPE
 *   `user_profiles` carries two CHECK constraints created by
 *   prisma/migrations/20260905000200_core_integrity_constraints/migration.sql:43-49
 *
 *     char_length(username) BETWEEN 3 AND 30
 *     username ~ '^[a-zA-Z0-9_]+$'
 *
 *   Every rule below is at least as strict as those, so a value this module
 *   accepts can never be refused by the constraint. The converse is deliberately
 *   false: policy (reserved words, underscore placement) lives here, where it can
 *   change without a migration, while shape lives in the database, where it
 *   cannot be bypassed by a second writer.
 *
 * CASE IS NOT IDENTITY
 *   `username` stores what the user typed. `username_normalized` stores
 *   lower(username) and carries the unique index. The pre-existing unique index
 *   on `username` is case-sensitive, so without the normalized column `@Party`
 *   and `@party` are two different accounts. That is an impersonation primitive,
 *   and it only becomes reachable the moment users can choose their own handle,
 *   which is why the column ships in the same change as the picker.
 *
 * WHY GENERATED HANDLES ARE NOT CHOOSABLE
 *   Signup derives `u_<base36(uuid)>` in `server/routes/auth.ts:88`. Those values
 *   are real, live handles belonging to accounts that have not completed
 *   onboarding. Letting anyone type one in would hand them another user's public
 *   identity, so the generated shape is reserved as a namespace.
 */

import { createHash } from 'crypto';

/** Minimum length, matching `user_profiles_username_length_check`. */
export const USERNAME_MIN_LENGTH = 3;

/** Maximum length, matching `user_profiles_username_length_check`. */
export const USERNAME_MAX_LENGTH = 30;

/**
 * How long a handle is locked after the user chooses it.
 *
 * A handle is a public identity that other people link to and recognise. Free
 * churn lets one account wear several identities in a week, and lets a released
 * name be grabbed by someone impersonating its previous owner. Thirty days is
 * long enough that a swap is a deliberate act and short enough to correct a
 * typo within a billing cycle of noticing it.
 */
export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

/**
 * How long a released handle stays unclaimable by anyone other than its
 * previous owner.
 *
 * Without this window the cooldown protects nothing: A renames away from
 * `@party`, B claims `@party` the same second, and every existing link to A now
 * resolves to B. The hold matches the cooldown so the two cannot be played
 * against each other.
 */
export const RELEASED_USERNAME_HOLD_DAYS = 30;

/** Hard cap on accepted raw input, before any other work is done. */
const MAX_RAW_INPUT_LENGTH = 200;

/** The character set the database CHECK constraint permits. */
const ALLOWED_CHARACTERS = /^[A-Za-z0-9_]+$/;

/** A canonical UUID, the id shape every real signup carries. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The exact shape `usernameFromUuid` emits (`server/routes/auth.ts:88-98`).
 *
 * Matched against the normalized form, which is why the alphabet is lowercase
 * base-36 only.
 */
const GENERATED_HANDLE_SHAPE = /^u_[0-9a-z]+$/;

/**
 * Handles no account may hold.
 *
 * Three groups, each with a distinct reason:
 *   1. Route and path segments that appear after the domain in a public profile
 *      URL. A user holding `settings` makes `/settings` ambiguous the day
 *      vanity URLs ship.
 *   2. Authority words. An account called `support` or `security` can ask other
 *      users for credentials and be believed.
 *   3. Brand terms. `partyhause` and its near variants are the product's own
 *      identity.
 *
 * Compared against the underscore-stripped normalized form, so `a_d_m_i_n`
 * is refused alongside `admin`.
 */
const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // 1. Path segments that already exist or are one feature away from existing.
  'about',
  'account',
  'accounts',
  'api',
  'auth',
  'blog',
  'callback',
  'contact',
  'cookie',
  'cookies',
  'create',
  'dashboard',
  'discover',
  'download',
  'downloads',
  'edit',
  'event',
  'events',
  'explore',
  'feed',
  'graphql',
  'guest',
  'guests',
  'home',
  'invite',
  'invites',
  'join',
  'legal',
  'login',
  'logout',
  'me',
  'media',
  'new',
  'notification',
  'notifications',
  'oauth',
  'onboarding',
  'poll',
  'polls',
  'privacy',
  'profile',
  'profiles',
  'public',
  'register',
  'reset',
  'rsvp',
  'search',
  'session',
  'sessions',
  'setting',
  'settings',
  'signin',
  'signout',
  'signup',
  'static',
  'status',
  'terms',
  'ticket',
  'tickets',
  'timeline',
  'user',
  'users',
  'vendor',
  'vendors',
  'verify',
  'webhook',
  'webhooks',
  'wellknown',

  // 2. Authority words, usable to impersonate the operator.
  'abuse',
  'admin',
  'administrator',
  'billing',
  'help',
  'info',
  'mod',
  'moderator',
  'noreply',
  'official',
  'owner',
  'payment',
  'payments',
  'postmaster',
  'root',
  'security',
  'staff',
  'superuser',
  'support',
  'sysadmin',
  'system',
  'team',
  'trust',
  'verified',
  'webmaster',

  // 3. Brand.
  'partyhause',
  'partyhaus',
  'partyhouse',
  'phause',
  'thepartyhause',
]);

/** Why a candidate handle was refused. Stable across clients. */
export type UsernameRejectionCode =
  | 'USERNAME_REQUIRED'
  | 'USERNAME_TOO_LONG'
  | 'USERNAME_TOO_SHORT'
  | 'USERNAME_INVALID_CHARACTERS'
  | 'USERNAME_EDGE_UNDERSCORE'
  | 'USERNAME_REPEATED_UNDERSCORE'
  | 'USERNAME_RESERVED'
  | 'USERNAME_SYSTEM_PREFIX';

/**
 * The verdict on one candidate handle.
 *
 * DELIBERATELY FLAT, NOT A DISCRIMINATED UNION
 *   A `{ ok: true, ... } | { ok: false, ... }` pair is the tidier shape and was
 *   written first. It does not work here: tsconfig.server.json and
 *   tsconfig.app.json both set `strict: false`, and without strictNullChecks
 *   TypeScript will not narrow a boolean discriminant, so every read of `code`
 *   after an `if (!check.ok)` guard was a compile error. A union that has to be
 *   unwrapped by hand at every call site is worse than four always-present
 *   fields. The unused fields are empty rather than absent so a misuse produces
 *   an empty string, which the length rule and the database CHECK both refuse,
 *   rather than `undefined` flowing into a query.
 */
export interface UsernameVerdict {
  /** True when every policy rule passed. */
  ok: boolean;
  /** The handle as the user typed it, trimmed. Empty when `ok` is false. */
  username: string;
  /** Lowercase form, uniquely indexed. Empty when `ok` is false. */
  normalized: string;
  /** Null when `ok` is true. */
  code: UsernameRejectionCode | null;
  /** Sentence fit to display. Null when `ok` is true. */
  message: string | null;
}

/** Build a rejection verdict. Keeps the empty-field convention in one place. */
function reject(code: UsernameRejectionCode, message: string): UsernameVerdict {
  return { ok: false, username: '', normalized: '', code, message };
}

/**
 * Reduce a handle to the form uniqueness is decided on.
 *
 * Trim then lowercase, and nothing else. Collapsing or stripping underscores
 * here was considered and rejected: it would make `a_b` and `ab` the same
 * account, which is surprising to users and takes legitimate names out of
 * circulation. Underscore confusability is handled by the placement rules and
 * the reserved-word skeleton instead, where it costs no namespace.
 *
 * @param raw Any value; non-strings normalize to the empty string.
 * @returns The normalized handle, possibly empty. Never throws.
 */
export function normalizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_RAW_INPUT_LENGTH).toLowerCase();
}

const REQUIRED_MESSAGE = 'Choose a username.';
const TOO_LONG_MESSAGE = `Usernames can be at most ${USERNAME_MAX_LENGTH} characters.`;

/** One policy rule: the condition that breaks it and what to tell the user. */
interface UsernameRule {
  code: UsernameRejectionCode;
  /** Shown verbatim. */
  message: string;
  /**
   * @param username The trimmed candidate, original casing.
   * @param normalized Its lowercase form.
   * @returns True when this candidate breaks the rule.
   */
  violated: (username: string, normalized: string) => boolean;
}

/**
 * The policy, in the order it is applied.
 *
 * A table rather than a chain of guard clauses for two reasons. The chain
 * measured cyclomatic complexity 12 against a limit of 10, and more usefully,
 * the rules are now data: they can be read end to end without following
 * control flow, and adding one is appending an entry rather than threading
 * another branch through a function that already returns from nine places.
 *
 * ORDER IS PART OF THE POLICY
 *   Cheapest and most specific first, so the sentence a user sees names the
 *   thing closest to what they typed. `__` is reported as a repeated
 *   underscore, not as an edge underscore, because the former is the more
 *   precise description of what is wrong with it.
 */
const USERNAME_RULES: readonly UsernameRule[] = [
  {
    code: 'USERNAME_REQUIRED',
    message: REQUIRED_MESSAGE,
    violated: (username) => username.length === 0,
  },
  {
    code: 'USERNAME_TOO_SHORT',
    message: `Usernames need at least ${USERNAME_MIN_LENGTH} characters.`,
    violated: (username) => username.length < USERNAME_MIN_LENGTH,
  },
  {
    code: 'USERNAME_TOO_LONG',
    message: TOO_LONG_MESSAGE,
    violated: (username) => username.length > USERNAME_MAX_LENGTH,
  },
  {
    code: 'USERNAME_INVALID_CHARACTERS',
    message: 'Use letters, numbers and underscores only.',
    violated: (username) => !ALLOWED_CHARACTERS.test(username),
  },
  {
    // An edge underscore is invisible at a glance beside the same name without
    // one, so `_partyhause` reads as `partyhause` in a mention.
    code: 'USERNAME_EDGE_UNDERSCORE',
    message: 'Usernames cannot start or end with an underscore.',
    violated: (username) => username.startsWith('_') || username.endsWith('_'),
  },
  {
    // Same reason, one position further in: `john__doe` and `john_doe` are not
    // distinguishable at a glance in running text.
    code: 'USERNAME_REPEATED_UNDERSCORE',
    message: 'Usernames cannot contain two underscores in a row.',
    violated: (username) => username.includes('__'),
  },
  {
    // usernameFromUuid emits this exact shape, and those are live handles on
    // accounts that have not onboarded. Typing one in would be taking somebody
    // else's public identity.
    code: 'USERNAME_SYSTEM_PREFIX',
    message:
      'Usernames cannot be "u_" followed only by letters and numbers. That form belongs to automatically assigned handles.',
    violated: (_username, normalized) => GENERATED_HANDLE_SHAPE.test(normalized),
  },
  {
    // Matched on the skeleton, so spacing a reserved word out with underscores
    // does not defeat the list: `a_d_m_i_n` reduces to `admin`.
    code: 'USERNAME_RESERVED',
    message: 'That username is reserved.',
    violated: (_username, normalized) => RESERVED_USERNAMES.has(normalized.replace(/_/g, '')),
  },
];

/**
 * The first rule a candidate breaks.
 *
 * @param username Trimmed candidate.
 * @param normalized Its lowercase form.
 * @returns The broken rule, or null when the candidate passes all of them.
 *
 * Complexity: O(r * n) for a fixed r of {@link USERNAME_RULES}.length and n
 * bounded by {@link MAX_RAW_INPUT_LENGTH}. Every regex is linear with no
 * nested quantifier, so there is no backtracking cost to bound.
 */
function firstViolation(username: string, normalized: string): UsernameRule | null {
  for (const rule of USERNAME_RULES) {
    if (rule.violated(username, normalized)) return rule;
  }
  return null;
}

/**
 * Apply every policy rule to a candidate handle.
 *
 * @param raw The value the user typed. Any type; non-strings are refused.
 * @returns A verdict carrying both stored forms on success, or a code and a
 *          displayable sentence on refusal. Never throws.
 *
 * Complexity: O(n) in the input length, bounded at
 * {@link MAX_RAW_INPUT_LENGTH} characters.
 */
export function validateUsername(raw: unknown): UsernameVerdict {
  // Two guards on the raw input before any per-rule work. A non-string has no
  // candidate to test, and a 10 MB string is refused on length rather than
  // trimmed and lowercased first.
  if (typeof raw !== 'string') return reject('USERNAME_REQUIRED', REQUIRED_MESSAGE);
  if (raw.length > MAX_RAW_INPUT_LENGTH) return reject('USERNAME_TOO_LONG', TOO_LONG_MESSAGE);

  const username = raw.trim();
  const normalized = username.toLowerCase();

  const violation = firstViolation(username, normalized);
  if (violation) return reject(violation.code, violation.message);

  return { ok: true, username, normalized, code: null, message: null };
}

/**
 * True when a handle was assigned by signup rather than chosen by its owner.
 *
 * Read from the stored value rather than from `username_set_at`, so the answer
 * is still correct for a row written before that column existed.
 *
 * @param username The stored handle.
 * @returns Whether it matches the shape `usernameFromUuid` emits.
 */
export function isGeneratedUsername(username: unknown): boolean {
  if (typeof username !== 'string') return false;
  return GENERATED_HANDLE_SHAPE.test(username.trim().toLowerCase());
}

/**
 * The generated handle for an account id, always valid.
 *
 * UUIDs (every real signup) derive from the full 128-bit value in base 36,
 * keeping complete entropy and the exact shape accounts already hold. Anything
 * else — the dev bypass user `dev-user-0000…` is the live example — hashes the
 * id instead, because a raw slice of a non-hex id yields characters (`-`) the
 * username format CHECK rejects, and Prisma 7 upserts validate the create
 * branch even when the update branch wins.
 *
 * Deterministic: the same id always derives the same handle, so a retried
 * upsert cannot collide with itself differently across attempts.
 *
 * @param id The account id. Any non-empty string.
 * @returns A handle matching `GENERATED_HANDLE_SHAPE`, 3-30 characters.
 */
export function generatedUsername(id: string): string {
  if (UUID_SHAPE.test(id)) {
    const hex = id.replace(/-/g, '');
    return `u_${BigInt(`0x${hex}`).toString(36)}`;
  }
  const digest = createHash('sha256').update(id).digest('hex');
  // 25 hex characters = 100 bits; base 36 keeps it under the 30-character cap.
  return `u_${BigInt(`0x${digest.slice(0, 25)}`).toString(36)}`;
}

/** Milliseconds in one day. Named so the arithmetic below reads. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The instant a handle becomes changeable again.
 *
 * @param usernameSetAt When the owner last chose a handle, or null when they
 *                      never have and are still on the generated one.
 * @returns The unlock instant, or null when no cooldown applies.
 */
export function usernameChangeAvailableAt(usernameSetAt: Date | null | undefined): Date | null {
  if (!usernameSetAt) return null;
  const setAtMs = usernameSetAt.getTime();
  if (!Number.isFinite(setAtMs)) return null;
  return new Date(setAtMs + USERNAME_CHANGE_COOLDOWN_DAYS * MS_PER_DAY);
}

/**
 * The instant a released handle becomes claimable by someone else.
 *
 * @param releasedAt When the previous owner gave it up.
 * @returns The instant the hold expires.
 */
export function releasedUsernameHoldExpiresAt(releasedAt: Date): Date {
  return new Date(releasedAt.getTime() + RELEASED_USERNAME_HOLD_DAYS * MS_PER_DAY);
}

/**
 * The oldest `released_at` that still counts as held.
 *
 * Expressed as a cutoff rather than a per-row expiry so the hold can be a
 * `released_at > cutoff` range scan on
 * `username_history (username_normalized, released_at)`, which is the index
 * the migration creates. Computing expiry per row instead would force a
 * sequential scan over every handle ever released.
 *
 * @param now Reference instant, injectable for tests.
 * @returns Rows with `released_at` strictly after this are still held.
 */
export function releasedUsernameHoldCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RELEASED_USERNAME_HOLD_DAYS * MS_PER_DAY);
}

/**
 * Whether the cooldown currently blocks a change.
 *
 * A change to the same normalized handle (casing only) does not go through
 * this check: it releases nothing, so there is nothing to protect.
 *
 * @param usernameSetAt When the owner last chose a handle.
 * @param now Reference instant, injectable for tests.
 * @returns Blocked with the unlock instant, or allowed.
 */
export function checkUsernameCooldown(
  usernameSetAt: Date | null | undefined,
  now: Date = new Date(),
): { blocked: false } | { blocked: true; availableAt: Date } {
  const availableAt = usernameChangeAvailableAt(usernameSetAt);
  if (!availableAt || now.getTime() >= availableAt.getTime()) {
    return { blocked: false };
  }
  return { blocked: true, availableAt };
}

/** How many candidates {@link buildUsernameCandidates} will ever return. */
export const MAX_USERNAME_SUGGESTIONS = 6;

/**
 * Reduce arbitrary text to the longest legal prefix usable as a handle stem.
 *
 * Accents and punctuation are dropped rather than transliterated. The allowed
 * alphabet is ASCII alphanumerics and underscore, and a transliteration table
 * that is wrong for one language is worse than an honest truncation that the
 * user can correct in the field.
 *
 * @param seed Display name, email local part, or a rejected candidate.
 * @returns A lowercase stem of at most {@link USERNAME_MAX_LENGTH} minus room
 *          for a suffix, or the empty string when nothing survives.
 */
function toStem(seed: unknown): string {
  if (typeof seed !== 'string') return '';
  const stem = seed
    .trim()
    .slice(0, MAX_RAW_INPUT_LENGTH)
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks left behind by the decomposition above, so
    // "renée" becomes "renee" rather than losing the vowel entirely.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  // Leave four characters of headroom so a numeric suffix still fits.
  return stem.slice(0, USERNAME_MAX_LENGTH - 4);
}

/**
 * Deterministic handle suggestions for a seed.
 *
 * Deterministic on purpose: the same seed produces the same list on every
 * keystroke, so the options do not reshuffle underneath a user who is reading
 * them. Availability is not consulted here, because this module performs no
 * I/O. The caller filters the list against the database and against
 * {@link validateUsername}, which is also applied here so a suggestion is never
 * a value the server would then refuse.
 *
 * @param seed Primary source, normally the display name.
 * @param fallbackSeed Secondary source used when the primary yields no stem,
 *                     normally the email local part.
 * @returns Up to {@link MAX_USERNAME_SUGGESTIONS} valid, distinct candidates.
 *          Empty when neither seed yields a usable stem.
 *
 * Complexity: O(1). The candidate list is a fixed-size construction over a
 * bounded stem, and the loop terminates on a constant bound.
 */
export function buildUsernameCandidates(seed: unknown, fallbackSeed?: unknown): string[] {
  const stem = toStem(seed) || toStem(fallbackSeed);
  if (stem.length === 0) return [];

  // Pad a short stem rather than emitting a candidate the length rule refuses.
  const base = stem.length >= USERNAME_MIN_LENGTH ? stem : `${stem}_hq`.slice(0, USERNAME_MAX_LENGTH);

  // Fixed suffixes first (they read as names), then digits (they always
  // resolve a collision). Ordered by how much they preserve the original.
  const suffixes = ['', '_hq', '_irl', '1', '7', '22', '_01', '99'];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const suffix of suffixes) {
    if (out.length >= MAX_USERNAME_SUGGESTIONS) break;
    // Trim the stem, not the suffix: a truncated suffix stops being meaningful.
    const trimmedBase = base.slice(0, USERNAME_MAX_LENGTH - suffix.length);
    const candidate = `${trimmedBase}${suffix}`.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (validateUsername(candidate).ok) out.push(candidate);
  }

  return out;
}
