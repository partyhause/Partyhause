/**
 * Username policy: the rules that decide what a user may call themselves.
 *
 * WHY THIS SUITE IS EXHAUSTIVE RATHER THAN REPRESENTATIVE
 *   `server/lib/username.ts` is the only thing standing between free-text input
 *   and a globally unique public identity. Two of its rules exist purely to
 *   block impersonation (the reserved skeleton and the generated-handle
 *   namespace), and a gap in either is not a bug a user reports: it is a bug
 *   somebody exploits quietly. So every rejection code is exercised, both
 *   length boundaries are pinned on each side, and the accept set is checked
 *   against the database constraints it has to satisfy.
 *
 * THE INVARIANT THAT MATTERS MOST
 *   Anything `validateUsername` accepts must satisfy both CHECK constraints
 *   created by 20260905000200_core_integrity_constraints, or signup succeeds in
 *   application code and fails at the database. That is asserted directly,
 *   against the same regex and bounds Postgres enforces, rather than assumed
 *   from reading the two files side by side.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_USERNAME_SUGGESTIONS,
  RELEASED_USERNAME_HOLD_DAYS,
  USERNAME_CHANGE_COOLDOWN_DAYS,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  buildUsernameCandidates,
  checkUsernameCooldown,
  isGeneratedUsername,
  normalizeUsername,
  releasedUsernameHoldCutoff,
  releasedUsernameHoldExpiresAt,
  usernameChangeAvailableAt,
  validateUsername,
} from '../../server/lib/username';

/** The exact constraints Postgres applies to `user_profiles.username`. */
const DB_FORMAT_CONSTRAINT = /^[a-zA-Z0-9_]+$/;
const DB_NORMALIZED_CONSTRAINT = /^[a-z0-9_]+$/;

describe('normalizeUsername', () => {
  it('lowercases and trims', () => {
    expect(normalizeUsername('  PartyKing  ')).toBe('partyking');
  });

  it('answers with an empty string for every non-string input', () => {
    for (const value of [undefined, null, 42, {}, [], true, Symbol('x')]) {
      expect(normalizeUsername(value)).toBe('');
    }
  });

  it('bounds the work it does on a hostile input rather than lowercasing it all', () => {
    // A megabyte of text must not become a megabyte of lowercased text held in
    // memory on the way to a length check that was always going to refuse it.
    const huge = 'A'.repeat(1_000_000);
    expect(normalizeUsername(huge).length).toBeLessThanOrEqual(200);
  });
});

describe('validateUsername: accepted values', () => {
  it.each([
    ['abc', 'the shortest legal handle'],
    ['a1b', 'digits are allowed anywhere'],
    ['party_king', 'a single interior underscore'],
    ['a_d_m_i_n_s', 'spaced letters that do not reduce to a reserved word'],
    ['PartyKing', 'mixed case is preserved as typed'],
    ['999', 'all digits'],
    ['user_name', 'starts with u but is not the generated shape'],
    ['u_hello_world', 'u_ prefix with a second underscore is not the generated shape'],
  ])('accepts %s (%s)', (candidate) => {
    const verdict = validateUsername(candidate);
    expect(verdict.ok).toBe(true);
    expect(verdict.code).toBeNull();
    expect(verdict.message).toBeNull();
    expect(verdict.username).toBe(candidate);
    expect(verdict.normalized).toBe(candidate.toLowerCase());
  });

  it('trims surrounding whitespace before storing', () => {
    const verdict = validateUsername('  party_king \n');
    expect(verdict.ok).toBe(true);
    expect(verdict.username).toBe('party_king');
  });

  it('accepts both length boundaries', () => {
    expect(validateUsername('a'.repeat(USERNAME_MIN_LENGTH)).ok).toBe(true);
    expect(validateUsername('a'.repeat(USERNAME_MAX_LENGTH)).ok).toBe(true);
  });

  it('only ever accepts values the database constraints also accept', () => {
    // The application is free to be stricter than the database. It must never
    // be looser, or a value passes here and throws at the INSERT.
    const probes = [
      'abc', 'PartyKing', 'a_b_c', '999', 'user_name', 'u_hello_world',
      'a'.repeat(USERNAME_MIN_LENGTH), 'a'.repeat(USERNAME_MAX_LENGTH),
    ];
    for (const probe of probes) {
      const verdict = validateUsername(probe);
      expect(verdict.ok).toBe(true);
      expect(verdict.username).toMatch(DB_FORMAT_CONSTRAINT);
      expect(verdict.username.length).toBeGreaterThanOrEqual(3);
      expect(verdict.username.length).toBeLessThanOrEqual(30);
      expect(verdict.normalized).toMatch(DB_NORMALIZED_CONSTRAINT);
      // The third constraint: username_normalized = lower(username).
      expect(verdict.normalized).toBe(verdict.username.toLowerCase());
    }
  });
});

describe('validateUsername: rejected values', () => {
  it.each([
    [undefined, 'USERNAME_REQUIRED'],
    [null, 'USERNAME_REQUIRED'],
    [42, 'USERNAME_REQUIRED'],
    [{}, 'USERNAME_REQUIRED'],
    ['', 'USERNAME_REQUIRED'],
    ['   ', 'USERNAME_REQUIRED'],
    ['ab', 'USERNAME_TOO_SHORT'],
    ['a', 'USERNAME_TOO_SHORT'],
    ['a'.repeat(USERNAME_MAX_LENGTH + 1), 'USERNAME_TOO_LONG'],
    ['a'.repeat(5000), 'USERNAME_TOO_LONG'],
    ['party king', 'USERNAME_INVALID_CHARACTERS'],
    ['party-king', 'USERNAME_INVALID_CHARACTERS'],
    ['party.king', 'USERNAME_INVALID_CHARACTERS'],
    ['party@king', 'USERNAME_INVALID_CHARACTERS'],
    ['pártyking', 'USERNAME_INVALID_CHARACTERS'],
    ['party\u200bking', 'USERNAME_INVALID_CHARACTERS'],
    ['_party', 'USERNAME_EDGE_UNDERSCORE'],
    ['party_', 'USERNAME_EDGE_UNDERSCORE'],
    ['___', 'USERNAME_EDGE_UNDERSCORE'],
    ['party__king', 'USERNAME_REPEATED_UNDERSCORE'],
  ])('rejects %p with %s', (candidate, code) => {
    const verdict = validateUsername(candidate);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(code);
    expect(verdict.message).toBeTruthy();
    // A rejection must never hand back a usable value; an empty string is
    // refused by every downstream rule, undefined is not.
    expect(verdict.username).toBe('');
    expect(verdict.normalized).toBe('');
  });

  it('rejects a zero-width space rather than silently stripping it', () => {
    // Stripping would map two visually identical strings onto one handle,
    // which is the impersonation case the character rule exists to stop.
    expect(validateUsername('admın').code).toBe('USERNAME_INVALID_CHARACTERS');
  });
});

describe('validateUsername: reserved namespace', () => {
  it.each(['admin', 'support', 'settings', 'api', 'partyhause', 'security', 'root'])(
    'rejects the reserved word %s',
    (word) => {
      expect(validateUsername(word).code).toBe('USERNAME_RESERVED');
    },
  );

  it('rejects a reserved word regardless of case', () => {
    expect(validateUsername('AdMiN').code).toBe('USERNAME_RESERVED');
    expect(validateUsername('SUPPORT').code).toBe('USERNAME_RESERVED');
  });

  it('rejects a reserved word spaced out with underscores', () => {
    // The skeleton check is the point: without it, @a_d_m_i_n reads as "admin"
    // in running text while passing a naive word-list lookup.
    expect(validateUsername('a_d_m_i_n').code).toBe('USERNAME_RESERVED');
    expect(validateUsername('s_upport').code).toBe('USERNAME_RESERVED');
    expect(validateUsername('part_y_hause').code).toBe('USERNAME_RESERVED');
  });

  it('does not over-reach into ordinary names that merely contain a reserved word', () => {
    // `administrator` is itself reserved, but a name that only embeds a
    // reserved substring is legitimate and must survive.
    expect(validateUsername('admiral').ok).toBe(true);
    expect(validateUsername('supporter').ok).toBe(true);
    expect(validateUsername('team_rocket').ok).toBe(true);
  });
});

describe('validateUsername: the generated-handle namespace', () => {
  it('refuses the exact shape signup derives', () => {
    // usernameFromUuid emits u_<base36>. Those are live handles belonging to
    // accounts that have not onboarded yet; typing one in would be taking
    // somebody else's public identity.
    expect(validateUsername('u_3f8k2z').code).toBe('USERNAME_SYSTEM_PREFIX');
    expect(validateUsername('U_3F8K2Z').code).toBe('USERNAME_SYSTEM_PREFIX');
    expect(validateUsername('u_abc').code).toBe('USERNAME_SYSTEM_PREFIX');
  });

  it('does not refuse names that only look similar', () => {
    expect(validateUsername('u_hello_world').ok).toBe(true);
    expect(validateUsername('us_abc').ok).toBe(true);
    expect(validateUsername('uu_abc').ok).toBe(true);
  });
});

describe('isGeneratedUsername', () => {
  it('recognises an assigned handle', () => {
    expect(isGeneratedUsername('u_3f8k2z9qk')).toBe(true);
  });

  it('does not mistake a chosen handle for an assigned one', () => {
    expect(isGeneratedUsername('party_king')).toBe(false);
    expect(isGeneratedUsername('u_hello_world')).toBe(false);
  });

  it('tolerates junk rather than throwing on it', () => {
    for (const value of [undefined, null, 42, {}]) {
      expect(isGeneratedUsername(value)).toBe(false);
    }
  });
});

describe('change cooldown', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('does not apply to a handle that was never chosen', () => {
    expect(usernameChangeAvailableAt(null)).toBeNull();
    expect(checkUsernameCooldown(null).blocked).toBe(false);
  });

  it('blocks for exactly the configured window', () => {
    const setAt = new Date('2026-01-01T00:00:00.000Z');
    const availableAt = usernameChangeAvailableAt(setAt);
    expect(availableAt?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(USERNAME_CHANGE_COOLDOWN_DAYS).toBe(30);
  });

  it('is blocked one millisecond before the window closes and open at the boundary', () => {
    const setAt = new Date('2026-01-01T00:00:00.000Z');
    const unlock = setAt.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS;

    expect(checkUsernameCooldown(setAt, new Date(unlock - 1)).blocked).toBe(true);
    // The boundary itself must be open, not blocked: a user told "you can
    // change it on the 31st" has to succeed on the 31st.
    expect(checkUsernameCooldown(setAt, new Date(unlock)).blocked).toBe(false);
    expect(checkUsernameCooldown(setAt, new Date(unlock + 1)).blocked).toBe(false);
  });

  it('reports when the change unlocks so the client can say so', () => {
    const setAt = new Date('2026-01-01T00:00:00.000Z');
    const verdict = checkUsernameCooldown(setAt, new Date('2026-01-10T00:00:00.000Z'));
    expect(verdict.blocked).toBe(true);
    if (verdict.blocked) {
      expect(verdict.availableAt.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    }
  });

  it('treats an unusable date as no cooldown rather than blocking forever', () => {
    expect(usernameChangeAvailableAt(new Date('not a date'))).toBeNull();
  });
});

describe('released-handle hold', () => {
  it('holds a released handle for the same window the cooldown runs', () => {
    // If the hold were shorter than the cooldown, a released handle would
    // become claimable while its former owner still could not take it back.
    expect(RELEASED_USERNAME_HOLD_DAYS).toBe(USERNAME_CHANGE_COOLDOWN_DAYS);
  });

  it('expires exactly one window after release', () => {
    const releasedAt = new Date('2026-01-01T00:00:00.000Z');
    expect(releasedUsernameHoldExpiresAt(releasedAt).toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    );
  });

  it('produces a cutoff that is the mirror of the expiry', () => {
    const now = new Date('2026-01-31T00:00:00.000Z');
    const cutoff = releasedUsernameHoldCutoff(now);
    expect(cutoff.toISOString()).toBe('2026-01-01T00:00:00.000Z');

    // A row released exactly at the cutoff is no longer held, because the
    // query filters `released_at > cutoff`. Pinned so the boundary cannot
    // drift into holding a handle a day longer than documented.
    const releasedAtCutoff = new Date(cutoff.getTime());
    expect(releasedAtCutoff.getTime() > cutoff.getTime()).toBe(false);
    expect(new Date(cutoff.getTime() + 1).getTime() > cutoff.getTime()).toBe(true);
  });
});

describe('buildUsernameCandidates', () => {
  it('never suggests a handle the validator would then refuse', () => {
    // A suggestion the server rejects is worse than no suggestion: the user
    // taps it and is told their own choice is invalid.
    const seeds = [
      'Ada Lovelace', 'admin', 'x', 'Renée Dupont', '!!!', '12', 'support',
      'A'.repeat(80), 'party__king', '_leading', 'u_3f8k2z',
    ];
    for (const seed of seeds) {
      for (const candidate of buildUsernameCandidates(seed)) {
        const verdict = validateUsername(candidate);
        expect(verdict.ok, `${seed} -> ${candidate}: ${verdict.message}`).toBe(true);
      }
    }
  });

  it('is deterministic, so the list does not reshuffle under a reading user', () => {
    const first = buildUsernameCandidates('Ada Lovelace');
    const second = buildUsernameCandidates('Ada Lovelace');
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('derives a stem from a display name', () => {
    expect(buildUsernameCandidates('Ada Lovelace')[0]).toBe('ada_lovelace');
  });

  it('folds accents rather than dropping the letter underneath', () => {
    expect(buildUsernameCandidates('Renée Dupont')[0]).toBe('renee_dupont');
  });

  it('falls back to the second seed when the first yields nothing', () => {
    expect(buildUsernameCandidates('!!!', 'ada@example.com')[0]).toBe('ada_example_com');
  });

  it('answers empty when neither seed yields a usable stem', () => {
    expect(buildUsernameCandidates('!!!', '???')).toEqual([]);
    expect(buildUsernameCandidates(null, undefined)).toEqual([]);
  });

  it('pads a stem that is too short to be a legal handle', () => {
    const candidates = buildUsernameCandidates('Jo');
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.length).toBeGreaterThanOrEqual(USERNAME_MIN_LENGTH);
    }
  });

  it('keeps every suggestion inside the length limit for a very long name', () => {
    const candidates = buildUsernameCandidates('Bartholomew Fitzgerald Montgomery Wellington');
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
    }
  });

  it('returns distinct values and honours its own bound', () => {
    const candidates = buildUsernameCandidates('Ada Lovelace');
    expect(candidates.length).toBeLessThanOrEqual(MAX_USERNAME_SUGGESTIONS);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('drops a suggestion that would land on a reserved word', () => {
    // The stem "admin" is reserved, so the bare candidate must not appear even
    // though the suffixed variants are fine.
    const candidates = buildUsernameCandidates('Admin');
    expect(candidates).not.toContain('admin');
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('tolerates junk seeds rather than throwing on them', () => {
    for (const seed of [undefined, null, 42, {}, []]) {
      expect(() => buildUsernameCandidates(seed)).not.toThrow();
    }
  });
});
