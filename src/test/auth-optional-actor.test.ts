/**
 * The two optional-identity middlewares, and why RSVP uses the newer one.
 *
 * `optionalAuth` substitutes the development bypass user when no usable token
 * is present. For most routes that is the point: local work should not need
 * ceremony. For RSVP it is fatal, because the entire question that route asks
 * is *which* account is answering. Under the bypass every local RSVP would bind
 * to dev@partyhause.local, the invited-address comparison could never fail, and
 * the anonymous path for grandfathered invitations would be unreachable on a
 * developer machine. `attachOptionalActor` is the same thing without that
 * fallback, and this file is what stops the two being merged back together.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  userUpsert: vi.fn(),
  profileUpsert: vi.fn(),
}));

vi.mock('../../server/lib/prisma', () => ({
  prisma: {
    user: { findUnique: prismaMocks.findUnique, upsert: prismaMocks.userUpsert },
    userProfile: { upsert: prismaMocks.profileUpsert },
  },
}));

import { attachOptionalActor, optionalAuth, type AuthenticatedRequest } from '../../server/middleware/auth';

const secret = 'optional-actor-test-secret-at-least-32-bytes';

const ACTIVE_USER = {
  id: 'user-1',
  email: 'guest@example.com',
  name: 'Guest',
  email_verified: true,
  token_version: 2,
  account_status: 'active',
};

function token(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      sub: ACTIVE_USER.id,
      email: ACTIVE_USER.email,
      name: ACTIVE_USER.name,
      email_verified: true,
      token_version: ACTIVE_USER.token_version,
      ...overrides,
    },
    secret,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

describe('optional identity middleware', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    process.env.JWT_SECRET = secret;
    process.env.NODE_ENV = 'test';
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.AUTH_BYPASS;
    prismaMocks.userUpsert.mockResolvedValue({ id: 'dev-user' });
    prismaMocks.profileUpsert.mockResolvedValue({ id: 'dev-user' });

    const app = express();
    const echo = (request: express.Request, response: express.Response): void => {
      response.json({ user: (request as AuthenticatedRequest).user ?? null });
    };
    app.get('/actor', attachOptionalActor, echo);
    app.get('/optional', optionalAuth, echo);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  async function get(path: string, bearer?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
    return (await response.json() as { user: { id: string; email?: string } | null }).user;
  }

  it('attaches a verified identity', async () => {
    prismaMocks.findUnique.mockResolvedValue(ACTIVE_USER);

    expect(await get('/actor', token())).toMatchObject({ id: 'user-1', email: 'guest@example.com' });
  });

  it('attaches nothing when no token is presented', async () => {
    expect(await get('/actor')).toBeNull();
    expect(prismaMocks.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['an unverified address', { ...ACTIVE_USER, email_verified: false }],
    ['a suspended account', { ...ACTIVE_USER, account_status: 'suspended' }],
    ['a stale token epoch', { ...ACTIVE_USER, token_version: 9 }],
    ['a deleted user', null],
  ])('attaches nothing for %s', async (_label, row) => {
    prismaMocks.findUnique.mockResolvedValue(row);

    expect(await get('/actor', token())).toBeNull();
  });

  it('attaches nothing for a token signed with the wrong key', async () => {
    const forged = jwt.sign({ sub: 'user-1', email_verified: true, token_version: 2 }, 'not-the-secret');

    expect(await get('/actor', forged)).toBeNull();
    expect(prismaMocks.findUnique).not.toHaveBeenCalled();
  });

  it('never substitutes the development bypass user, even with AUTH_BYPASS on', async () => {
    // The reason this middleware exists. A guest whose session has expired
    // presents a stale token, which is exactly the case optionalAuth turns
    // into the dev user; here it must stay anonymous so the RSVP service can
    // answer RSVP_ACCOUNT_REQUIRED rather than binding the seat to
    // dev@partyhause.local.
    process.env.AUTH_BYPASS = 'true';
    prismaMocks.findUnique.mockResolvedValue({ ...ACTIVE_USER, token_version: 9 });

    expect(await get('/actor', token())).toBeNull();
    expect(prismaMocks.userUpsert).not.toHaveBeenCalled();
  });

  it('differs from optionalAuth, which substitutes it for an unusable token', async () => {
    // Stated as a contrast rather than assumed, because it is the single
    // behavioural difference between the two and the whole justification for
    // having both. Note the precise trigger: a token that is present and
    // unusable, not the absence of one. optionalAuth returns early on no
    // token at all and never reaches the bypass, which is asserted below.
    process.env.AUTH_BYPASS = 'true';
    prismaMocks.findUnique.mockResolvedValue({ ...ACTIVE_USER, token_version: 9 });

    expect(await get('/optional', token())).toMatchObject({ email: 'dev@partyhause.local' });
  });

  it('agrees with optionalAuth when no token is presented at all', async () => {
    // optionalAuth's `if (!token) { next(); return; }` short-circuits above the
    // bypass. Worth pinning: it means the bypass is reachable only by holding a
    // broken credential, which is the opposite of what the name suggests.
    process.env.AUTH_BYPASS = 'true';

    expect(await get('/optional')).toBeNull();
    expect(await get('/actor')).toBeNull();
    expect(prismaMocks.userUpsert).not.toHaveBeenCalled();
  });

  it('agrees with optionalAuth that an unverified address is not an identity', async () => {
    // AGENTS.md long listed "optionalAuth does not enforce email_verified" as a
    // defect. It does not 403 the way requireAuth does, but it does not admit
    // the user either: applyVerifiedToken returns 'unverified' without setting
    // req.user. Pinned here because the two readings have opposite security
    // consequences and the sentence alone does not distinguish them.
    prismaMocks.findUnique.mockResolvedValue({ ...ACTIVE_USER, email_verified: false });

    expect(await get('/optional', token())).toBeNull();
    expect(await get('/actor', token())).toBeNull();
  });
});
