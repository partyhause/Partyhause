/**
 * Contract for the shared unique-violation helper.
 *
 * Eight call sites previously re-derived this decision, and the copies
 * disagreed on which Prisma/PostgreSQL codes count and what an absent
 * `meta.target` means. These tests pin the unified semantics so the next
 * call site imports the helper instead of growing a ninth copy:
 *
 *   - both P2002 (Prisma) and 23505 (PostgreSQL via the pg adapter) count,
 *     because the driver adapter surfaces either depending on the layer that
 *     raised the error;
 *   - an absent target is "cannot attribute", and only counts when the
 *     caller passes `untargetedCounts`, because attributing a conflict to a
 *     specific column is only safe when that column is the table's only
 *     unique constraint;
 *   - target matching is case-insensitive and substring-based, because
 *     Prisma names compound constraints (`users_email_key`) and reports
 *     compound targets as arrays.
 */

import { describe, expect, it } from 'vitest';

import { errorCode, isUniqueViolation, isUniqueViolationOn } from '../../server/lib/db-errors';

describe('isUniqueViolation', () => {
  it('accepts the Prisma unique-violation code', () => {
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['email'] } })).toBe(true);
  });

  it('accepts the PostgreSQL unique-violation code surfaced by the driver adapter', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('accepts a PrismaClientKnownRequestError instance by its code property', () => {
    const prismaError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: 'users_email_key' },
    });
    expect(isUniqueViolation(prismaError)).toBe(true);
  });

  it('refuses other Prisma request errors, including write conflicts', () => {
    expect(isUniqueViolation({ code: 'P2034' })).toBe(false);
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
  });

  it('refuses plain errors and non-objects without throwing', () => {
    expect(isUniqueViolation(new Error('database unavailable'))).toBe(false);
    expect(isUniqueViolation('unique violation')).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(42)).toBe(false);
  });
});

describe('isUniqueViolationOn', () => {
  it('matches a compound target array by any entry', () => {
    expect(isUniqueViolationOn({ code: 'P2002', meta: { target: ['event_id', 'user_id'] } }, 'user_id')).toBe(true);
  });

  it('matches a single constraint name containing the field', () => {
    expect(isUniqueViolationOn({ code: 'P2002', meta: { target: 'users_email_key' } }, 'email')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isUniqueViolationOn({ code: 'P2002', meta: { target: ['EMAIL'] } }, 'email')).toBe(true);
  });

  it('does not attribute a conflict to a column the target rules out', () => {
    expect(isUniqueViolationOn({ code: 'P2002', meta: { target: ['username'] } }, 'email')).toBe(false);
  });

  it('counts a target-less error only when the caller opts in', () => {
    const untargeted = { code: 'P2002', meta: {} };
    expect(isUniqueViolationOn(untargeted, 'email', true)).toBe(true);
    expect(isUniqueViolationOn(untargeted, 'email', false)).toBe(false);
    expect(isUniqueViolationOn({ code: 'P2002' }, 'email', true)).toBe(true);
  });

  it('returns false for every non-unique error regardless of opt-in', () => {
    expect(isUniqueViolationOn(new Error('connection lost'), 'email', true)).toBe(false);
  });
});

describe('errorCode', () => {
  it('returns the string code property', () => {
    expect(errorCode({ code: 'P2002' })).toBe('P2002');
  });

  it('returns empty for values without a code rather than throwing', () => {
    expect(errorCode(new Error('x'))).toBe('');
    expect(errorCode(null)).toBe('');
    expect(errorCode({ code: 123 })).toBe('123');
  });
});
