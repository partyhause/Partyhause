/**
 * The invited-signup path, against a real database.
 *
 * WHY THIS NEEDS PostgreSQL
 * The rule being tested is a join across four tables: the token hash resolves a
 * guest_invitations row, which must be unexpired and unrevoked, whose guest's
 * normalized_email must equal the address being registered. normalized_email is
 * maintained by a database trigger, so a mocked Prisma client would be asserting
 * against a value this code never actually compares.
 *
 * WHY IT IS WORTH A SUITE OF ITS OWN
 * This is the one place signup issues a session, and it does so on the strength
 * of a token rather than a confirmation link. Every branch that decides "no" is
 * therefore load-bearing: a wrong answer verifies an address nobody controlled.
 * The negative cases below are the point of the file, not padding.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashInvitationToken } from '../../server/lib/invitation-token';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../server/lib/legal';
import { prisma } from '../../server/lib/prisma';
import authRouter from '../../server/routes/auth';

const databaseAvailable = Boolean(process.env.DATABASE_URL);

const createdUserIds: string[] = [];
const createdEventIds: string[] = [];
let server: Server;
let baseUrl: string;

/** A token of the shape the RSVP surface accepts: 32 bytes, base64url, 43 chars. */
function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

function signupBody(email: string, extra: Record<string, unknown> = {}) {
  return {
    email,
    password: 'correct-horse-battery',
    name: 'Invited Person',
    ageEligible: true,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    ...extra,
  };
}

async function signup(body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/**
 * Create a published event with one invited guest and an invitation row.
 *
 * @param guestEmail The address the invitation is addressed to.
 * @param invitation Overrides for expiry and revocation, to build the
 *   negative cases without a second fixture.
 * @returns The raw token, which exists only here: the row stores its hash.
 */
async function inviteGuest(
  guestEmail: string,
  invitation: { createdAt?: Date; expiresAt?: Date; revokedAt?: Date | null } = {},
): Promise<string> {
  const hostId = randomUUID();
  createdUserIds.push(hostId);
  await prisma.user.create({
    data: {
      id: hostId,
      email: `host-${hostId}@invited-signup.invalid`,
      name: 'Host',
      email_verified: true,
    },
  });

  const event = await prisma.event.create({
    data: {
      host_id: hostId,
      name: 'Invited Signup Dinner',
      start_date: new Date('2030-02-01T18:00:00.000Z'),
      end_date: new Date('2030-02-01T20:00:00.000Z'),
      location: 'Integration Hall',
      status: 'published',
      privacy: 'private',
      is_public: false,
    },
  });
  createdEventIds.push(event.id);

  const guest = await prisma.guest.create({
    data: { event_id: event.id, name: 'Invited Person', email: guestEmail },
  });

  const token = mintToken();
  await prisma.guestInvitation.create({
    data: {
      guest_id: guest.id,
      event_id: event.id,
      token_hash: hashInvitationToken(token),
      // guest_invitations_expires_at_check enforces expires_at > created_at,
      // so an expired row cannot be conjured with a past expiry alone. Both
      // ends move, which is also how production produces one: an invitation
      // issued a while ago whose window has since closed.
      ...(invitation.createdAt ? { created_at: invitation.createdAt } : {}),
      expires_at: invitation.expiresAt ?? new Date('2030-02-01T20:00:00.000Z'),
      revoked_at: invitation.revokedAt ?? null,
    },
  });
  return token;
}

beforeAll(async () => {
  if (!databaseAvailable) return;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (!databaseAvailable) return;
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  if (createdEventIds.length > 0) {
    await prisma.guestInvitation.deleteMany({ where: { event_id: { in: createdEventIds } } });
    await prisma.guest.deleteMany({ where: { event_id: { in: createdEventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  const registered = await prisma.user.findMany({
    where: { email: { endsWith: '@invited-signup.invalid' } },
    select: { id: true },
  });
  const ids = [...new Set([...createdUserIds, ...registered.map((user) => user.id)])];
  await prisma.userProfile.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe.skipIf(!databaseAvailable)('invited signup', () => {
  it('verifies the address and returns a session when the token matches it', async () => {
    const email = `matched-${randomUUID()}@invited-signup.invalid`;
    const token = await inviteGuest(email);

    const { status, body } = await signup(signupBody(email, { inviteToken: token }));

    expect(status).toBe(201);
    // A token here is the whole point: the guest came from their inbox and must
    // not be sent back to it before they can answer.
    expect(typeof body.token).toBe('string');
    expect(body.user).toMatchObject({ email, email_verified: true });
    expect(body.invitation).toMatchObject({ eventId: expect.any(String), guestId: expect.any(String) });
    expect(await prisma.user.findFirstOrThrow({ where: { email } }))
      .toMatchObject({ email_verified: true });
  });

  it('falls back to ordinary confirmation when the token is for a different address', async () => {
    // The check that stops a forwarded link becoming an account at somebody
    // else's address.
    const invited = `invited-${randomUUID()}@invited-signup.invalid`;
    const other = `other-${randomUUID()}@invited-signup.invalid`;
    const token = await inviteGuest(invited);

    const { status, body } = await signup(signupBody(other, { inviteToken: token }));

    expect(status).toBe(201);
    expect(body.token).toBeUndefined();
    expect(body.user).toMatchObject({ email: other, email_verified: false });
    expect(await prisma.user.findFirstOrThrow({ where: { email: other } }))
      .toMatchObject({ email_verified: false });
  });

  it('refuses an expired invitation', async () => {
    const email = `expired-${randomUUID()}@invited-signup.invalid`;
    const token = await inviteGuest(email, {
      createdAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    });

    const { body } = await signup(signupBody(email, { inviteToken: token }));

    expect(body.token).toBeUndefined();
    expect(body.user).toMatchObject({ email_verified: false });
  });

  it('refuses a revoked invitation', async () => {
    const email = `revoked-${randomUUID()}@invited-signup.invalid`;
    const token = await inviteGuest(email, { revokedAt: new Date() });

    const { body } = await signup(signupBody(email, { inviteToken: token }));

    expect(body.token).toBeUndefined();
    expect(body.user).toMatchObject({ email_verified: false });
  });

  it.each([
    ['a token for no invitation', mintToken()],
    ['a token of the wrong shape', 'not-a-token'],
    ['an empty string', ''],
    ['a non-string', 12345],
  ])('refuses %s', async (_label, inviteToken) => {
    const email = `junk-${randomUUID()}@invited-signup.invalid`;

    const { status, body } = await signup(signupBody(email, { inviteToken }));

    // Junk in this field must never fail the signup, only decline to verify it.
    // Rejecting outright would let a malformed link block registration.
    expect(status).toBe(201);
    expect(body.token).toBeUndefined();
    expect(body.user).toMatchObject({ email_verified: false });
  });

  it('leaves an ordinary signup untouched', async () => {
    const email = `plain-${randomUUID()}@invited-signup.invalid`;

    const { status, body } = await signup(signupBody(email));

    expect(status).toBe(201);
    expect(body.token).toBeUndefined();
    expect(body.invitation).toBeUndefined();
    expect(body.user).toMatchObject({ email_verified: false });
    expect(body.verificationDelivery).toBeDefined();
  });
});
