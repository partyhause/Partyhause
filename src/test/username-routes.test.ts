/**
 * The four username and onboarding endpoints, exercised over real HTTP.
 *
 * WHAT THIS SUITE IS FOR
 *   `username-policy.test.ts` pins the rules. This pins the things that only
 *   exist once those rules meet a database and an Express router: the change
 *   cooldown, the released-handle hold, the no-op that must not restart the
 *   clock, the 409 for a race the advisory availability check cannot prevent,
 *   and the skip that is refused for accounts which were offered the choice.
 *
 * WHY PRISMA IS MOCKED RATHER THAN REAL
 *   Vitest runs under jsdom with no Postgres, so a route suite either mocks the
 *   client or is skipped in CI. Skipped is what the existing integration suites
 *   already are, and this logic is too easy to get wrong to leave uncovered on
 *   every pull request. The database's own guarantees (the unique index on
 *   username_normalized, the CHECK that ties it to lower(username)) were
 *   verified directly against Postgres when the migration was written; what is
 *   mocked here is storage, not the rules being tested.
 *
 * ROUTE ORDER IS PART OF THE CONTRACT
 *   Every literal path in this router must be registered before `/:id`, or
 *   Express binds it as an id and the endpoint 404s for its whole life.
 *   `GET /api/email-logs/analytics/event` shipped exactly that way. The first
 *   test asserts the ordering directly.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-secret-value-that-is-long-enough-32';

const prismaMocks = vi.hoisted(() => ({
  profileFindUnique: vi.fn(),
  profileFindMany: vi.fn(),
  profileUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  historyFindFirst: vi.fn(),
  historyFindMany: vi.fn(),
  historyCreate: vi.fn(),
  historyDeleteMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../server/lib/prisma', () => ({
  prisma: {
    userProfile: {
      findUnique: prismaMocks.profileFindUnique,
      findMany: prismaMocks.profileFindMany,
      update: prismaMocks.profileUpdate,
    },
    user: { findUnique: prismaMocks.userFindUnique },
    usernameHistory: {
      findFirst: prismaMocks.historyFindFirst,
      findMany: prismaMocks.historyFindMany,
      create: prismaMocks.historyCreate,
      deleteMany: prismaMocks.historyDeleteMany,
    },
    $transaction: prismaMocks.transaction,
  },
}));

const DAY_MS = 24 * 60 * 60 * 1000;

let server: Server;
let baseUrl: string;
let signToken: (subject: string) => string;

/**
 * A fresh identity per test.
 *
 * Both username limiters are keyed on the user id, and the claim limiter
 * allows 10 attempts per hour. Sharing one id across the suite exhausts that
 * budget partway through and turns later assertions into 429s that say nothing
 * about the code under test. A distinct user per test is also closer to
 * reality than one user issuing every request in the file.
 */
let userId: string;
let token: string;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.NODE_ENV = 'test';
  // The bypass would admit every request as the synthetic dev user and make
  // each authorization assertion below pass for the wrong reason.
  delete process.env.AUTH_BYPASS;

  const jwt = (await import('jsonwebtoken')).default;
  signToken = (subject) =>
    jwt.sign(
      { sub: subject, email: 'person@example.com', email_verified: true, token_version: 0 },
      SECRET,
      { expiresIn: '1h' },
    );

  const { default: usersRouter } = await import('../../server/routes/users');
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  userId = randomUUID();
  token = signToken(userId);

  // Serves two readers. `requireAuth` re-reads the identity on every request
  // to honour token revocation (middleware/auth.ts:120-137), so account_status
  // and token_version must be present and must match the JWT or every call
  // 401s. The onboarding route reads the same mock for `email` and `name`,
  // which it uses as the fallback seed for suggestions.
  prismaMocks.userFindUnique.mockResolvedValue({
    id: userId,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    email_verified: true,
    token_version: 0,
    account_status: 'active',
  });
  prismaMocks.profileFindMany.mockResolvedValue([]);
  prismaMocks.historyFindMany.mockResolvedValue([]);
  prismaMocks.historyFindFirst.mockResolvedValue(null);
  prismaMocks.historyCreate.mockResolvedValue({});
  prismaMocks.historyDeleteMany.mockResolvedValue({ count: 0 });
  // The route's transaction callback is the unit under test; run it against
  // the same mocks rather than stubbing its result, or the history write and
  // the profile update would never be observed.
  prismaMocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      usernameHistory: {
        create: prismaMocks.historyCreate,
        deleteMany: prismaMocks.historyDeleteMany,
      },
      userProfile: { update: prismaMocks.profileUpdate },
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Issue an authenticated request against the mounted router. */
function call(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/** A profile row in the shape the routes select. */
function profileRow(over: Record<string, unknown> = {}) {
  return {
    id: userId,
    username: 'u_3f8k2z',
    username_normalized: 'u_3f8k2z',
    display_name: 'Ada Lovelace',
    username_set_at: null,
    onboarding_skipped_at: null,
    onboarding_required: true,
    ...over,
  };
}

describe('route registration order', () => {
  it('resolves every literal path instead of binding it as an id', async () => {
    // Regression guard for the defect GET /api/email-logs/analytics/event
    // shipped with: a literal registered after /:id is bound as id="analytics"
    // and answers 404 forever. A 404 from any of these means the ordering broke.
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());

    for (const path of ['/api/users/me/onboarding', '/api/users/username-available?username=abc']) {
      const response = await call(path);
      expect(response.status, `${path} must not be shadowed by /:id`).not.toBe(404);
    }

    const skip = await call('/api/users/me/onboarding/skip', { method: 'POST' });
    expect(skip.status).not.toBe(404);

    const claim = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'ada_lovelace' }),
    });
    expect(claim.status).not.toBe(404);
  });
});

describe('GET /api/users/username-available', () => {
  it('requires authentication', async () => {
    const response = await fetch(`${baseUrl}/api/users/username-available?username=abc`);
    expect(response.status).toBe(401);
  });

  it('answers 200 with a reason for a refused candidate rather than 400', async () => {
    // A live field would otherwise emit a stream of 400s indistinguishable
    // from a transport fault while the user is mid-word.
    const response = await call('/api/users/username-available?username=ab');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.available).toBe(false);
    expect(body.code).toBe('USERNAME_TOO_SHORT');
    expect(body.message).toBeTruthy();
  });

  it('reports a free handle as available', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(null);
    const body = await (await call('/api/users/username-available?username=ada_lovelace')).json();
    expect(body).toEqual({ username: 'ada_lovelace', available: true });
  });

  it('reports a handle held by somebody else as taken', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue({ id: 'somebody-else' });
    const body = await (await call('/api/users/username-available?username=ada_lovelace')).json();
    expect(body.available).toBe(false);
    expect(body.code).toBe('USERNAME_TAKEN');
  });

  it('does not tell a user their own handle belongs to somebody else', async () => {
    // A normalized match against the caller's own row is a casing edit, not a
    // collision. Reporting it as taken is both wrong and alarming.
    prismaMocks.profileFindUnique.mockResolvedValue({ id: userId });
    const body = await (await call('/api/users/username-available?username=Ada_Lovelace')).json();
    expect(body.available).toBe(true);
  });

  it('reports a recently released handle as held', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(null);
    prismaMocks.historyFindFirst.mockResolvedValue({ id: 'hold-1' });
    const body = await (await call('/api/users/username-available?username=ada_lovelace')).json();
    expect(body.available).toBe(false);
    expect(body.code).toBe('USERNAME_ON_HOLD');
  });

  it('excludes the caller from the hold check so they can reclaim their own name', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(null);
    await call('/api/users/username-available?username=ada_lovelace');
    expect(prismaMocks.historyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ profile_id: { not: userId } }),
      }),
    );
  });
});

describe('GET /api/users/me/onboarding', () => {
  it('requires authentication', async () => {
    expect((await fetch(`${baseUrl}/api/users/me/onboarding`)).status).toBe(401);
  });

  it('shows the picker to a new account that has not chosen', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());
    const body = await (await call('/api/users/me/onboarding')).json();

    expect(body.show_picker).toBe(true);
    expect(body.skippable).toBe(false);
    expect(body.has_chosen_username).toBe(false);
    expect(body.username_is_generated).toBe(true);
    expect(body.can_change_at).toBeNull();
    expect(body.limits).toEqual({
      min_length: 3,
      max_length: 30,
      cooldown_days: 30,
      max_suggestions: 6,
    });
  });

  it('offers suggestions derived from the display name', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());
    const body = await (await call('/api/users/me/onboarding')).json();
    expect(body.suggestions).toContain('ada_lovelace');
  });

  it('withholds a suggestion somebody already holds', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());
    prismaMocks.profileFindMany.mockResolvedValue([{ username_normalized: 'ada_lovelace' }]);
    const body = await (await call('/api/users/me/onboarding')).json();
    expect(body.suggestions).not.toContain('ada_lovelace');
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  it('makes the picker dismissible for an account that predates it', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow({ onboarding_required: false }));
    const body = await (await call('/api/users/me/onboarding')).json();
    expect(body.show_picker).toBe(true);
    expect(body.skippable).toBe(true);
  });

  it('stops prompting a pre-existing account that already dismissed it', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(
      profileRow({ onboarding_required: false, onboarding_skipped_at: new Date() }),
    );
    const body = await (await call('/api/users/me/onboarding')).json();
    expect(body.show_picker).toBe(false);
  });

  it('keeps prompting a new account even after a skip was somehow recorded', async () => {
    // The skip endpoint refuses these accounts, so a recorded dismissal here
    // could only come from a direct write. It must not open the gate.
    prismaMocks.profileFindUnique.mockResolvedValue(
      profileRow({ onboarding_required: true, onboarding_skipped_at: new Date() }),
    );
    const body = await (await call('/api/users/me/onboarding')).json();
    expect(body.show_picker).toBe(true);
  });

  it('reports the cooldown for a user who has already chosen', async () => {
    const setAt = new Date(Date.now() - 5 * DAY_MS);
    prismaMocks.profileFindUnique.mockResolvedValue(
      profileRow({ username: 'ada', username_normalized: 'ada', username_set_at: setAt }),
    );
    const body = await (await call('/api/users/me/onboarding')).json();

    expect(body.show_picker).toBe(false);
    expect(body.has_chosen_username).toBe(true);
    expect(body.username_is_generated).toBe(false);
    expect(new Date(body.can_change_at).getTime()).toBe(setAt.getTime() + 30 * DAY_MS);
  });
});

describe('POST /api/users/me/onboarding/skip', () => {
  it('refuses an account that was offered the choice', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow({ onboarding_required: true }));
    const response = await call('/api/users/me/onboarding/skip', { method: 'POST' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('ONBOARDING_REQUIRED');
    expect(prismaMocks.profileUpdate).not.toHaveBeenCalled();
  });

  it('records the dismissal for an account that predates the picker', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow({ onboarding_required: false }));
    prismaMocks.profileUpdate.mockResolvedValue({});

    const response = await call('/api/users/me/onboarding/skip', { method: 'POST' });
    expect(response.status).toBe(200);
    expect((await response.json()).skipped).toBe(true);
    expect(prismaMocks.profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { onboarding_skipped_at: expect.any(Date) },
      }),
    );
  });

  it('is idempotent for a user who has already chosen', async () => {
    // A double tap must not read as a failure.
    prismaMocks.profileFindUnique.mockResolvedValue(
      profileRow({ username_set_at: new Date(), onboarding_required: false }),
    );
    const response = await call('/api/users/me/onboarding/skip', { method: 'POST' });
    expect(response.status).toBe(200);
    expect((await response.json()).skipped).toBe(false);
    expect(prismaMocks.profileUpdate).not.toHaveBeenCalled();
  });
});

describe('PUT /api/users/me/username', () => {
  it('requires authentication', async () => {
    const response = await fetch(`${baseUrl}/api/users/me/username`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ada' }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a policy violation with its code', async () => {
    const response = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'admin' }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('USERNAME_RESERVED');
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('claims a generated handle and records its release', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());
    prismaMocks.profileUpdate.mockResolvedValue({ username: 'ada_lovelace' });

    const response = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'Ada_Lovelace' }),
    });
    expect(response.status).toBe(200);

    // Both stored forms are written, and they agree: the database CHECK
    // username_normalized = lower(username) makes any disagreement an error.
    expect(prismaMocks.profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'Ada_Lovelace',
          username_normalized: 'ada_lovelace',
          username_set_at: expect.any(Date),
          onboarding_skipped_at: null,
        }),
      }),
    );
    expect(prismaMocks.historyCreate).toHaveBeenCalledWith({
      data: {
        profile_id: userId,
        username: 'u_3f8k2z',
        username_normalized: 'u_3f8k2z',
      },
    });
  });

  it('drops any hold this account itself had on the handle it is taking', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());
    prismaMocks.profileUpdate.mockResolvedValue({});

    await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'ada_lovelace' }),
    });

    // Without this the owner would be blocked from reclaiming their own
    // former identity by a hold they created.
    expect(prismaMocks.historyDeleteMany).toHaveBeenCalledWith({
      where: { profile_id: userId, username_normalized: 'ada_lovelace' },
    });
  });

  it('blocks a change inside the cooldown and says when it lifts', async () => {
    const setAt = new Date(Date.now() - 5 * DAY_MS);
    prismaMocks.profileFindUnique.mockResolvedValue(
      profileRow({ username: 'ada', username_normalized: 'ada', username_set_at: setAt }),
    );

    const response = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'grace' }),
    });
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.code).toBe('USERNAME_CHANGE_TOO_SOON');
    expect(new Date(body.available_at).getTime()).toBe(setAt.getTime() + 30 * DAY_MS);
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('allows a casing edit during the cooldown, because it releases nothing', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(
      profileRow({ username: 'ada', username_normalized: 'ada', username_set_at: new Date() }),
    );
    prismaMocks.profileUpdate.mockResolvedValue({});

    const response = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'Ada' }),
    });
    expect(response.status).toBe(200);
    // No release: the handle never left this account, so holding it against
    // everyone else would be holding it against nobody.
    expect(prismaMocks.historyCreate).not.toHaveBeenCalled();
  });

  it('treats a resubmission of the same handle as a no-op', async () => {
    // Writing username_set_at here would silently restart a 30-day cooldown
    // for a user who changed nothing.
    const setAt = new Date(Date.now() - 40 * DAY_MS);
    prismaMocks.profileFindUnique.mockResolvedValue(
      profileRow({ username: 'ada', username_normalized: 'ada', username_set_at: setAt }),
    );

    const response = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'ada' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).unchanged).toBe(true);
    expect(prismaMocks.profileUpdate).not.toHaveBeenCalled();
    expect(prismaMocks.historyCreate).not.toHaveBeenCalled();
  });

  it('refuses a handle another account released recently', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());
    prismaMocks.historyFindFirst.mockResolvedValue({ id: 'hold-1' });

    const response = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'grace_hopper' }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('USERNAME_ON_HOLD');
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it('answers 409 when it loses the race the availability check cannot prevent', async () => {
    // Two callers can both be told a handle is free; only one can win the
    // unique index. The loser must get the 409 they would have had a moment
    // earlier, not a 500.
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());
    prismaMocks.profileUpdate.mockRejectedValue(
      Object.assign(new Error('unique'), {
        code: 'P2002',
        meta: { target: ['username_normalized'] },
      }),
    );

    const response = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'ada_lovelace' }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('USERNAME_TAKEN');
  });

  it('does not disguise an unrelated failure as a conflict', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());
    prismaMocks.profileUpdate.mockRejectedValue(new Error('database unavailable'));

    const response = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'ada_lovelace' }),
    });
    expect(response.status).toBe(500);
  });

  it('answers 404 when the profile row is missing', async () => {
    prismaMocks.profileFindUnique.mockResolvedValue(null);
    const response = await call('/api/users/me/username', {
      method: 'PUT',
      body: JSON.stringify({ username: 'ada_lovelace' }),
    });
    expect(response.status).toBe(404);
  });

  it('bounds one account to ten claim attempts per hour', async () => {
    // A globally unique namespace mutated behind a 30-day cooldown should see
    // roughly one successful claim a month per account. The limiter exists to
    // bound the failed attempts that never reach the cooldown check, which is
    // what a script hunting for a freed handle would generate.
    prismaMocks.profileFindUnique.mockResolvedValue(profileRow());
    prismaMocks.profileUpdate.mockResolvedValue({});

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await call('/api/users/me/username', {
        method: 'PUT',
        body: JSON.stringify({ username: `candidate_${attempt}` }),
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
