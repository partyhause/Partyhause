/**
 * The two web capabilities that existed on the server and nowhere in `src/`.
 *
 * PUBLISHING
 *   `POST /api/events` honours `status` since server/lib/event-status.ts, and
 *   `assertFuturePublished` (server/lib/mvp-invitations.ts:253-260) refuses to
 *   send an invitation for anything that is not published. The web client never
 *   sent `status` and had no publish control, so every event it created stayed
 *   a draft forever and no web host could invite anybody. The server half was
 *   done and the loop was still shut.
 *
 * DELETION
 *   The routes, the shared resource in packages/core, and the mobile screen
 *   were all complete. `src/` had no deletion control of any kind. Now that
 *   RSVP requires an account, every guest has one, so the population that may
 *   want to delete is about to grow by an order of magnitude.
 *
 * Both are asserted at the service boundary rather than through the DOM: these
 * files are where the request shape is decided, and the request shape is what
 * was wrong.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../lib/api-client', () => ({
  apiGet: apiMocks.get,
  apiPost: apiMocks.post,
  apiPut: apiMocks.put,
  apiDelete: apiMocks.del,
}));

import {
  DELETION_CONFIRMATION_WORD,
  accountService,
  describeDeletionError,
  receiptIsDead,
} from '../lib/account';

/**
 * The real event service, not the global stub.
 *
 * src/test/setup.ts mocks `@/lib/events` for every file so background loads in
 * the store do not throw. That stub is right for component tests and wrong
 * here, where the request shape is the thing under test. Loaded in `beforeAll`
 * rather than at module scope because a top-level await alongside static
 * imports fails the esbuild transform.
 */
let eventService: typeof import('../lib/events')['eventService'];

beforeAll(async () => {
  ({ eventService } = await vi.importActual<typeof import('../lib/events')>('../lib/events'));
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

describe('publishing an event from the web', () => {
  const row = {
    id: 'event-1',
    name: 'Fortieth',
    status: 'published',
    start_date: '2026-10-01T18:00:00.000Z',
    end_date: '2026-10-01T23:00:00.000Z',
  };

  it('sends exactly { status: published } to the event it names', async () => {
    apiMocks.put.mockResolvedValue({ data: { event: row }, error: null });

    await eventService.publishEvent('event-1');

    expect(apiMocks.put).toHaveBeenCalledWith('/api/events/event-1', { status: 'published' });
  });

  it('returns the normalized event so the caller can refresh its copy', async () => {
    apiMocks.put.mockResolvedValue({ data: { event: row }, error: null });

    const result = await eventService.publishEvent('event-1');

    expect('event' in result && result.event.status).toBe('published');
  });

  it('surfaces the refusal rather than discarding it', async () => {
    // updateEvent answers null on failure, which is survivable for a field
    // edit and not for a state change the host is waiting on.
    apiMocks.put.mockResolvedValue({
      data: null,
      error: { message: 'status must be one of: draft, published', status: 400 },
    });

    const result = await eventService.publishEvent('event-1');

    expect(result).toEqual({ error: 'status must be one of: draft, published' });
  });

  it('does not report success when the server returns no event', async () => {
    apiMocks.put.mockResolvedValue({ data: { success: true }, error: null });

    const result = await eventService.publishEvent('event-1');

    expect('error' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

describe('account deletion from the web', () => {
  const deletion = {
    receipt: 'rcpt_1',
    status: 'pending' as const,
    requestedAt: '2026-09-15T10:00:00.000Z',
    eraseBy: '2026-10-15T10:00:00.000Z',
    completedAt: null,
    confirmationExpiresAt: '2026-09-15T10:15:00.000Z',
    retryable: true,
  };

  it('re-authenticates with the password and unwraps the receipt', async () => {
    apiMocks.post.mockResolvedValue({ data: { deletion }, error: null });

    const result = await accountService.createDeletionIntent('hunter2');

    expect(apiMocks.post).toHaveBeenCalledWith(
      '/api/mvp/account/deletion-intent',
      { password: 'hunter2' },
    );
    expect(result.data?.receipt).toBe('rcpt_1');
  });

  it('confirms anonymously, because the session it would carry is being destroyed', async () => {
    apiMocks.post.mockResolvedValue({ data: { accepted: true, deletion }, error: null });

    await accountService.confirmDeletion('rcpt_1', DELETION_CONFIRMATION_WORD);

    const [path, body, options] = apiMocks.post.mock.calls[0];
    expect(path).toBe('/api/mvp/account/deletion');
    expect(body).toEqual({ receipt: 'rcpt_1', confirmation: 'DELETE' });
    expect(options).toEqual({ anonymous: true });
  });

  it('sends what the user typed, so the server is the only arbiter', async () => {
    // A client-side equality check would be a second implementation of a rule
    // the server already owns, and the two can disagree.
    apiMocks.post.mockResolvedValue({ data: null, error: { code: 'DELETION_CONFIRMATION_INVALID' } });

    await accountService.confirmDeletion('rcpt_1', 'delete');

    expect(apiMocks.post.mock.calls[0][1]).toEqual({ receipt: 'rcpt_1', confirmation: 'delete' });
  });

  it('carries the code alongside the rendered message', async () => {
    // The view renders `error`; the flow asks receiptIsDead about `code`.
    // Returning only prose would force the caller to match on copy.
    apiMocks.post.mockResolvedValue({
      data: null,
      error: { code: 'DELETION_CONFIRMATION_EXPIRED', message: 'expired' },
    });

    const result = await accountService.confirmDeletion('rcpt_1', 'DELETE');

    expect(result.code).toBe('DELETION_CONFIRMATION_EXPIRED');
    expect(result.error).toBe('That confirmation window closed. Start again with your password.');
  });

  it('never reports success without a deletion body', async () => {
    apiMocks.post.mockResolvedValue({ data: { accepted: true }, error: null });

    const result = await accountService.confirmDeletion('rcpt_1', 'DELETE');

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('deletion error copy', () => {
  it('names the remedy for every code the server can send', () => {
    // Transcribed from server/lib/account.ts. A code with no case falls
    // through to the raw server message, which is what this guards against.
    const codes = [
      'PASSWORD_REQUIRED',
      'PASSWORD_REAUTH_FAILED',
      'ACCOUNT_NOT_ACTIVE',
      'DELETION_CONFIRMATION_INVALID',
      'DELETION_CONFIRMATION_EXPIRED',
      'DELETION_RECEIPT_NOT_FOUND',
      'DELETION_STATE_INVALID',
      'DELETION_RATE_LIMITED',
    ];

    for (const code of codes) {
      expect(describeDeletionError(code, 'FALLBACK'), code).not.toBe('FALLBACK');
    }
  });

  it('falls back rather than inventing a reason for an unknown code', () => {
    expect(describeDeletionError('SOMETHING_NEW', 'FALLBACK')).toBe('FALLBACK');
    expect(describeDeletionError(undefined, 'FALLBACK')).toBe('FALLBACK');
  });

  it('matches the copy mobile shows for the same code', () => {
    // Two clients, one contract. They drifted on this once already, which is
    // why packages/core exists.
    expect(describeDeletionError('PASSWORD_REAUTH_FAILED', 'x')).toBe(
      'That password is not correct. Nothing has been deleted.',
    );
  });

  it('identifies exactly the codes that make a held receipt unusable', () => {
    expect(receiptIsDead('DELETION_CONFIRMATION_EXPIRED')).toBe(true);
    expect(receiptIsDead('DELETION_RECEIPT_NOT_FOUND')).toBe(true);
    expect(receiptIsDead('DELETION_STATE_INVALID')).toBe(true);

    // A wrong word is retryable with the same receipt. Sending the user back
    // to the password step for a typo would be a worse product.
    expect(receiptIsDead('DELETION_CONFIRMATION_INVALID')).toBe(false);
    expect(receiptIsDead('DELETION_RATE_LIMITED')).toBe(false);
    expect(receiptIsDead(undefined)).toBe(false);
  });
});
