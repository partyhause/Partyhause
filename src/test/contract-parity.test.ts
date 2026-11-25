/**
 * The contract must agree with the database, and nothing may redeclare it.
 *
 * WHY THIS SUITE EXISTS
 *   A single source of truth is a claim about the repository, not about one
 *   file, and claims about a repository rot silently. Before this change the
 *   same concepts were typed up to eleven times, and the copies disagreed in
 *   fifteen measured ways. Three of those disagreements were live 500s,
 *   because a hand-rolled route check was looser than the CHECK constraint it
 *   wrote through, so the route said 200 and Postgres said no.
 *
 *   `npm run audit:contracts` cannot catch any of that. It compares response
 *   envelope keys, never payload fields, never request bodies, and it does not
 *   scan `src/` at all. It is a useful net for one bug class and was never
 *   meant to be this.
 *
 * WHAT IS ASSERTED, AND AGAINST WHAT
 *   The migration SQL is parsed and the contract enums are compared against
 *   the CHECK constraints themselves, rather than against a second hardcoded
 *   list in this file. A list here would be a twelfth copy of the thing this
 *   change exists to remove, and it would drift the same way.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emailStatus,
  eventPrivacy,
  eventStatus,
  eventType,
  guestRole,
  guestPatch,
  guestCreateBatch,
  notification,
  parseContract,
  poll,
  rsvpStatus,
  userProfileDetail,
} from '../../packages/core/src/contracts';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'prisma/migrations');

/** Every migration's SQL, newest last, concatenated. */
function allMigrationSql(): string {
  return fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => fs.readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8'))
    .join('\n');
}

/**
 * The value list from the LAST definition of a named CHECK constraint.
 *
 * Last, not first, because a constraint can be dropped and re-added with a
 * different vocabulary. `guests_rsvp_status_check` is exactly that: defined
 * with five values in 20260905000200, dropped in 20260906000000, and redefined
 * with four. Reading the first would assert the vocabulary that was replaced.
 *
 * @param sql Concatenated migration SQL, oldest first.
 * @param constraint The constraint name.
 * @returns The `IN (...)` members, or null when the constraint is not an IN list.
 */
function checkConstraintValues(sql: string, constraint: string): string[] | null {
  const pattern = new RegExp(
    `ADD CONSTRAINT\\s+${constraint}\\s*CHECK\\s*\\(([^)]*\\([^)]*\\))?[^)]*\\)`,
    'gi',
  );
  const occurrences = [...sql.matchAll(new RegExp(`ADD CONSTRAINT\\s+${constraint}\\b`, 'gi'))];
  if (occurrences.length === 0) return null;
  void pattern;

  const last = occurrences[occurrences.length - 1].index ?? 0;
  const tail = sql.slice(last, last + 600);
  const inList = tail.match(/IN\s*\(([^)]*)\)/i);
  if (!inList) return null;
  return inList[1]
    .split(',')
    .map((value) => value.trim().replace(/^'|'$/g, ''))
    .filter((value) => value.length > 0);
}

const SQL = allMigrationSql();

describe('contract enums match the CHECK constraints they are transcribed from', () => {
  it.each([
    ['guests_rsvp_status_check', rsvpStatus],
    ['events_status_check', eventStatus],
    ['events_privacy_check', eventPrivacy],
    ['events_event_type_check', eventType],
    ['guests_role_check', guestRole],
    ['guests_email_status_check', emailStatus],
  ])('%s', (constraint, schema) => {
    const fromDatabase = checkConstraintValues(SQL, constraint);
    expect(fromDatabase, `${constraint} not found in any migration`).not.toBeNull();
    expect([...(schema.options as string[])].sort()).toEqual([...fromDatabase!].sort());
  });

  it('refuses the rsvp value the constraint dropped', () => {
    // 'confirmed' was a member until 20260906000000 rewrote every such row to
    // 'accepted' (:87-88), narrowed the constraint (:118-119) and VALIDATEd it
    // (:137). Three client types and one route still admitted it afterwards,
    // which is a 500 rather than a lenient read.
    expect(SQL).toMatch(/VALIDATE CONSTRAINT guests_rsvp_status_check/);
    expect(rsvpStatus.safeParse('confirmed').success).toBe(false);
    expect(rsvpStatus.safeParse('accepted').success).toBe(true);
  });
});

describe('guest contract closes the three live 500s', () => {
  it('refuses an empty email, which the normalized_email CHECK refuses', () => {
    // server/routes/guests.ts wrote `guest.email || ''`. The
    // normalize_guest_email trigger derives normalized_email from it and CHECK
    // guests_normalized_email_check requires length > 0.
    expect(SQL).toMatch(/length\(normalized_email\)\s*>\s*0/);
    const result = parseContract(guestCreateBatch, {
      eventId: 'e1',
      guests: [{ name: 'Ada', email: '' }],
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a check-in paired with a non-accepted RSVP', () => {
    expect(SQL).toMatch(/guests_check_in_requires_accepted_check/);
    expect(parseContract(guestPatch, { checkedIn: true, rsvpStatus: 'pending' }).ok).toBe(false);
    expect(parseContract(guestPatch, { checkedIn: true, rsvpStatus: 'accepted' }).ok).toBe(true);
  });

  it('refuses rsvpStatus confirmed on the write path', () => {
    expect(parseContract(guestPatch, { rsvpStatus: 'confirmed' }).ok).toBe(false);
  });

  it('caps a batch at the guest limit the trigger enforces', () => {
    expect(SQL).toMatch(/enforce_event_guest_limit/);
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      name: `Guest ${i}`,
      email: `g${i}@example.com`,
    }));
    expect(parseContract(guestCreateBatch, { eventId: 'e1', guests: tooMany }).ok).toBe(false);
  });

  it('refuses an empty patch instead of issuing a no-op update', () => {
    expect(parseContract(guestPatch, {}).ok).toBe(false);
  });

  it('normalises an email rather than trusting the caller to', () => {
    const result = parseContract(guestCreateBatch, {
      eventId: 'e1',
      guests: [{ name: 'Ada', email: '  Ada@Example.COM ' }],
    });
    expect(result.ok).toBe(true);
    expect(result.value?.guests[0].email).toBe('ada@example.com');
  });
});

describe('contract shapes match what the routes actually send', () => {
  it('poll options are text and votes, never label and vote_count', () => {
    // packages/core previously declared `label` and `vote_count`. The server
    // sends `text` and `votes` (server/routes/polls.ts:89,92). All five poll
    // endpoints passed audit:contracts, because it never inspects the payload.
    const shape = poll.shape.options.element.shape;
    expect(Object.keys(shape).sort()).toEqual(
      ['description', 'id', 'text', 'user_has_voted', 'voters', 'votes'].sort(),
    );
    expect(shape).not.toHaveProperty('label');
    expect(shape).not.toHaveProperty('vote_count');
  });

  it('a poll carries status, not is_closed', () => {
    expect(poll.shape).toHaveProperty('status');
    expect(poll.shape).not.toHaveProperty('is_closed');
  });

  it('a notification carries read, not read_at', () => {
    // `read_at` would be undefined for every row, read or not, so every
    // notification rendered as unread forever on any client reading it.
    expect(notification.shape).toHaveProperty('read');
    expect(notification.shape).not.toHaveProperty('read_at');
    expect(parseContract(notification.shape.read, true).ok).toBe(true);
  });

  it('last_active_at is nullable, because the server nulls it for privacy', () => {
    // Typed non-nullable on the web, so useUserProfile.ts "defaulted" a null
    // to `new Date()` and displayed a user who hid their activity as active
    // right now. The type inverted a privacy setting.
    expect(userProfileDetail.shape.last_active_at.safeParse(null).success).toBe(true);
  });

  it('viewer relationship flags are optional, because anonymous callers get none', () => {
    const parsed = userProfileDetail.safeParse({
      id: 'u1',
      username: 'ada',
      display_name: 'Ada',
      bio: null,
      avatar_url: null,
      cover_photo_url: null,
      location: null,
      website_url: null,
      partycrew_count: 0,
      crewing_count: 0,
      events_hosted: 0,
      haus_score: 0,
      is_verified: false,
      is_private: false,
      account_type: 'personal',
      created_at: '2026-01-01T00:00:00.000Z',
      last_active_at: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('the single source of truth stays single', () => {
  const deleted = ['shared-types.ts', 'packages/core/src/store.ts'];

  it.each(deleted)('%s stays deleted', (relative) => {
    // shared-types.ts had zero importers, appeared in no tsconfig include, and
    // declared an API_ENDPOINTS map naming nine routes that do not exist.
    // Anyone who found it inherited a fictional API.
    expect(fs.existsSync(path.join(ROOT, relative))).toBe(false);
  });

  it('the web client is an adapter, not a second transport implementation', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/lib/api-client.ts'), 'utf8');
    expect(source).toContain("from '@partyhause/core'");
    expect(source).toContain('createTransport');
    // The markers of a hand-rolled transport. Their absence is what says this
    // file delegates rather than reimplements.
    expect(source).not.toMatch(/RETRYABLE_STATUS/);
    expect(source).not.toMatch(/new AbortController\(\)/);
  });

  it('zod never reaches a client bundle', () => {
    // Schemas live behind @partyhause/core/contracts, which only the server
    // imports. types.ts re-exports the inferred types with `export type`,
    // which TypeScript erases. This also keeps the two zod majors apart: root
    // resolves 3.x, apps/mobile/node_modules holds 4.x via dev tooling.
    const types = fs.readFileSync(path.join(ROOT, 'packages/core/src/types.ts'), 'utf8');

    // No zod import at all in the client-facing module.
    expect(types).not.toMatch(/from ['"]zod['"]/);

    // Every statement that reaches into ./contracts must be type-only, so
    // TypeScript erases it and no bundler follows the edge. Matched on the
    // statement rather than the line, because these are multi-line specifier
    // lists whose closing brace does not start with the keyword.
    const contractStatements = types.match(/(?:^|\n)\s*(import|export)\b[\s\S]*?from '\.\/contracts';/g) ?? [];
    expect(contractStatements.length).toBeGreaterThan(0);
    for (const statement of contractStatements) {
      expect(statement.trim()).toMatch(/^(import type|export type)\b/);
    }

    // And the barrel must not re-export the schemas either.
    const index = fs.readFileSync(path.join(ROOT, 'packages/core/src/index.ts'), 'utf8');
    expect(index).not.toMatch(/from ['"]\.\/contracts['"]/);
  });

