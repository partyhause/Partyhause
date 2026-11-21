/**
 * The web app has one HTTP client, and the two live bugs the split caused
 * stay fixed.
 *
 * WHY A STRUCTURAL SUITE
 *   The nine transports this collapses did not diverge on purpose. Each was
 *   written because the shared one could not do one thing: send an anonymous
 *   request, set a referrer policy, carry an error code, send a multipart
 *   body, or take longer than fifteen seconds. Each gap is now closed in the
 *   shared client, so the next person who needs one of those has no reason to
 *   write a tenth. This suite fails if one appears anyway.
 *
 *   The behavioural half matters more than the count. Two of those clients
 *   were silently broken for their entire lives, and neither had a test.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/** Every non-test module under src/ that could hold a transport. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'test' || entry.name === 'mcp') continue;
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

describe('one transport', () => {
  it('no module under src/ calls fetch directly', () => {
    // `src/lib/api-client.ts` does not call fetch either: it delegates to
    // packages/core's transport, which owns the single call.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      // Strip comments so a comment describing the old code is not a match.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/(?<![.\w])fetch\s*\(/.test(code)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders, 'these modules bypass the shared client').toEqual([]);
  });

  it('the shared client closes every gap that justified a separate one', () => {
    const client = read('src/lib/api-client.ts');
    // anonymous: login and RSVP. Without it a 401 on a failed login signs the
    // user out mid-login, which is why auth.ts had its own fetch.
    expect(client).toMatch(/anonymous\?: boolean/);
    // timeoutMs: uploads. image-utils.ts used a bare fetch with no timeout.
    expect(client).toMatch(/timeoutMs\?: number/);
    // code: the reason auth.ts existed. 403 EMAIL_NOT_VERIFIED vs 401.
    expect(client).toMatch(/code\?: string/);
    // a DELETE body: three routes require one and the web could not call them.
    expect(client).toMatch(/apiDelete<T = unknown>\(\s*path: string,\s*body\?: unknown/);
  });

  it('anonymous requests carry the hardening the RSVP flow depends on', () => {
    // The RSVP token is in the page URL and IS the credential, because the
    // guest replying has no account. These three stop it leaking through a
    // Referer header, a shared cache, or an unrelated cookie.
    const transport = read('packages/core/src/http/transport.ts');
    expect(transport).toMatch(/credentials: 'omit'/);
    expect(transport).toMatch(/cache: 'no-store'/);
    expect(transport).toMatch(/referrerPolicy: 'no-referrer'/);
  });

  it('a FormData body is handed to the platform unserialised', () => {
    // Only the platform knows the multipart boundary. JSON.stringify on a
    // FormData produces "{}" and multer sees an empty upload.
    const transport = read('packages/core/src/http/transport.ts');
    expect(transport).toMatch(/isPlatformEncodedBody/);
    expect(transport).toMatch(/!platformEncoded/);
  });
});

describe('the timeline no longer erases itself', () => {
  const timeline = read('src/lib/timeline.ts');

  it('reads the table, not the JSON column the DTO withholds', () => {
    // server/lib/event-dto.ts:146-164 is an allowlist and timeline_blocks is
    // deliberately absent, so the old read always produced []. Every write was
    // a read-modify-write on top of that, which replaced the whole schedule
    // with whatever single block was being added.
    expect(timeline).toMatch(/\/api\/timeline\//);
    expect(timeline).not.toMatch(/event\?\.timeline_blocks/);
  });

  it('has no read-modify-write helpers left to reintroduce it', () => {
    // Comments stripped first: the module header names these functions when
    // explaining why they were removed, and that prose is not a definition.
    const code = timeline.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The table addresses a block by id, so nothing needs the whole schedule
    // in order to change one row. These four had no callers outside the file.
    for (const dead of [
      'addTimelineBlock',
      'updateTimelineBlock',
      'deleteTimelineBlock',
      'getPublicTimeline',
    ]) {
      expect(code, `${dead} is the pattern that caused the data loss`).not.toContain(dead);
    }
  });

  it('creates replacements before deleting what they replace', () => {
    // Order is the whole safety property. Deleting first and failing a create
    // leaves the user with nothing, which is the bug being fixed.
    const createIndex = timeline.indexOf("apiPost('/api/timeline'");
    const deleteIndex = timeline.indexOf('apiDelete(`/api/timeline/');
    expect(createIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeLessThan(deleteIndex);
  });
});

describe('the invite email can actually send', () => {
  const tracking = read('src/lib/email-tracking.ts');

  it('goes through the authenticated client', () => {
    // server/index.ts:270 mounts POST /api/send-email behind requireAuth. The
    // bare fetch sent no Authorization header, so the web invite flow 401'd
    // before it reached any of the route's own checks.
    expect(tracking).toMatch(/apiPost<\{[\s\S]*?\}>\('\/api\/send-email'/);
  });

  it('sends event_id, which the route requires and authorizes against', () => {
    // server/index.ts:292-294. The event id used to be buried in `metadata`,
    // which the route does not read.
    const call = tracking.slice(tracking.indexOf("'/api/send-email'"));
    expect(call.slice(0, 400)).toMatch(/event_id:\s*logData\.eventId/);
  });

  it('keeps exactly one email sender in the web app', () => {
    // There were four, three of them dead and all four missing auth and
    // event_id. Only apps/mobile/lib/email.ts ever got it right.
    expect(fs.existsSync(path.join(ROOT, 'src/api/sendEmail.ts'))).toBe(false);
    expect(read('src/lib/email.ts')).not.toMatch(/export const sendEmail/);
    expect(tracking).not.toMatch(/export const sendEmail\b/);
    expect(tracking).toMatch(/export const sendEmailWithTracking/);
  });
});
