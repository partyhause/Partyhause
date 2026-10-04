/**
 * The path that mints an RSVP token, and the omission that made it unreachable.
 *
 * WHY THIS FILE EXISTS
 *   `GuestInvitation` rows are written only by `MvpInvitationsService.send`
 *   (server/lib/mvp-invitations.ts:859), reached through
 *   `POST /api/mvp/events/:eventId/invitations/send`. The typed client for it,
 *   `createMvpInvitationsResource`, has existed since the MVP surface was
 *   written and was wired into `createMvpApiClient` in packages/core/src/mvp.ts,
 *   whose only caller is a test.
 *
 *   `createApiClient`, the factory both applications actually use, had no
 *   `invitations` member. So nothing an application could call wrote a
 *   `GuestInvitation`, no token existed, and `/join/:token` was built, correct
 *   and unreachable. Recorded as defect 2 in docs/ROADMAP.md.
 *
 *   This is the second time this exact omission shipped. The `account` member
 *   carries a comment in packages/core/src/client.ts describing the first,
 *   where `createAccountResource` was complete and absent from the interface,
 *   which made in-app deletion impossible and blocked App Store submission.
 *   The assertions below are cheap; a resource that exists and is not exposed
 *   costs a release.
 */

import { describe, expect, it, vi } from 'vitest';

import { createApiClient, createMvpIdempotencyKey } from '@partyhause/core';
import { createMvpApiClient } from '@partyhause/core/mvp';
import { createMemoryStorage } from '@partyhause/core';

const BASE_URL = 'https://api.test.local';

function clientWith(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl);
  return createApiClient({ baseUrl: BASE_URL, storage: createMemoryStorage() });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SEND_RESULT = {
  eventId: 'event-1',
  requestedCount: 2,
  attemptedCount: 2,
  results: [
    {
      guestId: 'guest-1',
      name: 'Ada',
      status: 'queued',
      attempted: true,
      provider: 'acs',
      providerMessageId: 'msg-1',
      errorCode: null,
    },
    {
      guestId: 'guest-2',
      name: 'Grace',
      status: 'failed',
      attempted: true,
      provider: 'acs',
      providerMessageId: null,
      errorCode: 'PROVIDER_REJECTED',
    },
  ],
};

describe('the shared client exposes invitation sending', () => {
  it('has an invitations resource, which is what mints a token', () => {
    // The defect was exactly this member being absent.
    const client = createApiClient({ baseUrl: BASE_URL, storage: createMemoryStorage() });

    expect(client.invitations).toBeDefined();
    expect(typeof client.invitations.send).toBe('function');
    expect(typeof client.invitations.getForEvent).toBe('function');
  });

  it('exposes the same resource shape as the MVP-only client', () => {
    // Two factories over one resource. If they diverge, one application loses a
    // capability silently, which is how this defect happened the first time.
    const storage = createMemoryStorage();
    const shared = createApiClient({ baseUrl: BASE_URL, storage });
    const mvp = createMvpApiClient({ baseUrl: BASE_URL, storage });

    expect(Object.keys(shared.invitations).sort()).toEqual(Object.keys(mvp.invitations).sort());
  });
});

describe('invitation send request', () => {
  it('posts guest ids and an Idempotency-Key to the MVP send route', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = clientWith((async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse(SEND_RESULT);
    }) as unknown as typeof fetch);

    await client.invitations.send('event-1', ['guest-1', 'guest-2'], 'invitation.send:abc');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}/api/mvp/events/event-1/invitations/send`);
    expect(calls[0].init.method).toBe('POST');

    const headers = new Headers(calls[0].init.headers);
    // The server refuses a write without it (server/lib/mvp-contract.ts:346).
    expect(headers.get('Idempotency-Key')).toBe('invitation.send:abc');

    // Addresses and content are never accepted: recipients are ids resolved
    // against the event's own guest list, which is what stops this endpoint
    // being a mail relay.
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ guestIds: ['guest-1', 'guest-2'] });
  });

  it('percent-encodes the event id rather than interpolating it raw', async () => {
    const calls: string[] = [];
    const client = clientWith((async (url: string) => {
      calls.push(String(url));
      return jsonResponse(SEND_RESULT);
    }) as unknown as typeof fetch);

    await client.invitations.send('ev/../admin', ['guest-1'], 'k');

    expect(calls[0]).toContain('ev%2F..%2Fadmin');
  });

  it('returns the per-guest outcome rather than one boolean', async () => {
    const client = clientWith((async () => jsonResponse(SEND_RESULT)) as unknown as typeof fetch);

    const { data, error } = await client.invitations.send('event-1', ['guest-1', 'guest-2'], 'k');

    expect(error).toBeFalsy();
    // A partial send has to be reportable as one. The legacy path this replaces
    // returned a single success flag plus a list of email addresses.
    expect(data?.results.map((item) => [item.guestId, item.status])).toEqual([
      ['guest-1', 'queued'],
      ['guest-2', 'failed'],
    ]);
  });

  it('surfaces the server code for a draft event', async () => {
    // Reachable for the first time now that publishing works, and actionable:
    // the host must publish before inviting.
    const client = clientWith((async () =>
      jsonResponse(
        { code: 'EVENT_NOT_PUBLISHED', error: 'Invitations can be sent only for a published event' },
        409,
      )) as unknown as typeof fetch);

    const { data, error } = await client.invitations.send('event-1', ['guest-1'], 'k');

    expect(data).toBeFalsy();
    expect(error?.status).toBe(409);
    expect(error?.code).toBe('EVENT_NOT_PUBLISHED');
  });
});

describe('createMvpIdempotencyKey', () => {
  it('is reachable from the shared entry point, not only from ./mvp', () => {
    // The shared client now carries a command endpoint, so it needs the helper
    // every command endpoint requires.
    expect(typeof createMvpIdempotencyKey).toBe('function');
  });

  it('prefixes with the scope so a command log stays legible', () => {
    expect(createMvpIdempotencyKey('invitation.send')).toMatch(/^invitation\.send:.+/);
  });

  it('does not repeat across calls', () => {
    const keys = new Set(Array.from({ length: 200 }, () => createMvpIdempotencyKey('s')));
    expect(keys.size).toBe(200);
  });

  it('still produces a key when crypto.randomUUID is unavailable', () => {
    // Absent on older React Native runtimes and in non-secure browser contexts.
    // A client that throws there cannot send anything at all.
    const original = globalThis.crypto;
    try {
      vi.stubGlobal('crypto', {});
      expect(createMvpIdempotencyKey('s')).toMatch(/^s:.+/);
    } finally {
      vi.stubGlobal('crypto', original);
    }
  });
});
