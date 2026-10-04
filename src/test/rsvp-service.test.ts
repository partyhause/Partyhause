import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { RsvpService, type RsvpActor } from '../../server/lib/rsvp';

const now = new Date('2030-01-01T00:00:00.000Z');
const token = Buffer.alloc(32, 7).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');

const INVITED_EMAIL = 'guest@example.com';
const INVITED_HINT = 'g****@example.com';
const invitee: RsvpActor = { id: 'user-1', email: INVITED_EMAIL };
const stranger: RsvpActor = { id: 'user-2', email: 'someone.else@example.com' };

function guestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'guest-1',
    event_id: 'event-1',
    rsvp_status: 'pending',
    rsvp_responded_at: null,
    revision: 1,
    normalized_email: INVITED_EMAIL,
    user_id: null,
    ...overrides,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'event-1',
    expires_at: new Date('2030-02-01T20:00:00.000Z'),
    revoked_at: null,
    requires_account: true,
    event: {
      id: 'event-1',
      name: 'Dinner',
      start_date: new Date('2030-02-01T18:00:00.000Z'),
      end_date: new Date('2030-02-01T20:00:00.000Z'),
      timezone: 'UTC',
      location: 'Hall',
      status: 'published',
      privacy: 'private',
      is_public: false,
      cancelled_at: null,
      host: { name: 'Host Name', account_status: 'active' },
    },
    guest: guestRow(),
    ...overrides,
  };
}

function databaseWithRows(...rows: Array<ReturnType<typeof invitation> | null>) {
  const guestInvitation = { findUnique: vi.fn() };
  for (const row of rows) guestInvitation.findUnique.mockResolvedValueOnce(row);
  const guest = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue(rows.length > 0 ? [{ id: 'invitation-1' }] : []),
    guestInvitation,
    guest,
  };
  const database = {
    ...transaction,
    $transaction: vi.fn(async (work: (client: typeof transaction) => Promise<unknown>) => work(transaction)),
  } as unknown as PrismaClient;
  return { database, guest, guestInvitation, service: new RsvpService(database, () => now) };
}

describe('RSVP service: public read', () => {
  it('resolves a token without mutating or exposing guest identity', async () => {
    const fixture = databaseWithRows(invitation());
    const response = await fixture.service.resolve({ token });

    expect(response.body).toEqual({
      event: {
        name: 'Dinner',
        hostName: 'Host Name',
        start: '2030-02-01T18:00:00.000Z',
        end: '2030-02-01T20:00:00.000Z',
        timezone: 'UTC',
        location: 'Hall',
      },
      rsvp: {
        status: 'pending',
        revision: 1,
        respondedAt: null,
        requiresAccount: true,
        claimed: false,
        invitedEmailHint: INVITED_HINT,
      },
    });
    expect(fixture.guestInvitation.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { token_hash: hash },
    }));
    expect(fixture.guest.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('guest-1');
  });

  it('never returns the invited address in full', async () => {
    // The hint exists so a guest can tell which of their addresses was
    // invited. Returning the whole thing would hand it to anyone holding a
    // forwarded link, and an invited signup auto-verifies on that address.
    const fixture = databaseWithRows(invitation());
    const response = await fixture.service.resolve({ token });

    expect(response.body.rsvp.invitedEmailHint).toBe(INVITED_HINT);
    expect(JSON.stringify(response.body)).not.toContain(INVITED_EMAIL);
  });

  it('reports a claimed seat', async () => {
    const fixture = databaseWithRows(invitation({ guest: guestRow({ user_id: 'user-1' }) }));
    const response = await fixture.service.resolve({ token });

    expect(response.body.rsvp.claimed).toBe(true);
  });

  it('stays readable with no session so an invitee can see what they are joining', async () => {
    // resolve takes no actor at all. If this signature ever grows one, the
    // invitation becomes unreadable to the people it is addressed to.
    const fixture = databaseWithRows(invitation());
    await expect(fixture.service.resolve({ token })).resolves.toMatchObject({ status: 200 });
  });

  it.each([
    ['unknown', null],
    ['expired', invitation({ expires_at: new Date('2029-12-31T23:59:59.000Z') })],
    ['revoked', invitation({ revoked_at: new Date('2029-12-31T00:00:00.000Z') })],
    ['cancelled', invitation({ event: { ...invitation().event, status: 'cancelled', cancelled_at: now } })],
  ])('returns the same unavailable result for an %s invitation', async (_label, row) => {
    const fixture = databaseWithRows(row);
    await expect(fixture.service.resolve({ token })).rejects.toMatchObject({
      status: 404,
      code: 'RSVP_UNAVAILABLE',
      message: 'This invitation is unavailable',
    });
  });

  it('returns the same unavailable result for a malformed token', async () => {
    const fixture = databaseWithRows();
    await expect(fixture.service.resolve({ token: 'short' })).rejects.toMatchObject({
      status: 404,
      code: 'RSVP_UNAVAILABLE',
      message: 'This invitation is unavailable',
    });
    expect(fixture.guestInvitation.findUnique).not.toHaveBeenCalled();
  });
});

describe('RSVP service: the account requirement', () => {
  it('refuses an anonymous answer and names the reason', async () => {
    const fixture = databaseWithRows(invitation());

    await expect(fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, null))
      .rejects.toMatchObject({ status: 401, code: 'RSVP_ACCOUNT_REQUIRED' });
    expect(fixture.guest.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an account whose address is not the invited one', async () => {
    const fixture = databaseWithRows(invitation());

    await expect(fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, stranger))
      .rejects.toMatchObject({ status: 403, code: 'RSVP_EMAIL_MISMATCH' });
    expect(fixture.guest.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a seat another account already claimed', async () => {
    const fixture = databaseWithRows(invitation({ guest: guestRow({ user_id: 'someone-else' }) }));

    await expect(fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, invitee))
      .rejects.toMatchObject({ status: 409, code: 'RSVP_ALREADY_CLAIMED' });
    expect(fixture.guest.updateMany).not.toHaveBeenCalled();
  });

  it('matches the address case-insensitively and ignoring surrounding space', async () => {
    // guests.normalized_email is lower(btrim(email)) by trigger. An account
    // whose stored address differs only by case must not be told it was not
    // invited.
    const updated = invitation({ guest: guestRow({ rsvp_status: 'accepted', revision: 2, user_id: 'user-1' }) });
    const fixture = databaseWithRows(invitation(), updated);

    await expect(fixture.service.update(
      { token, status: 'accepted', expectedRevision: 1 },
      { id: 'user-1', email: '  GUEST@Example.com ' },
    )).resolves.toMatchObject({ status: 200 });
  });

  it('checks authorization before revealing whether the answer was already stored', async () => {
    // The idempotent early return must not run first. If it did, an
    // unauthorized caller could submit each status in turn and learn the
    // stored one from which submission came back 200 instead of 401.
    const fixture = databaseWithRows(invitation({ guest: guestRow({ rsvp_status: 'accepted', revision: 4 }) }));

    await expect(fixture.service.update({ token, status: 'accepted', expectedRevision: 4 }, null))
      .rejects.toMatchObject({ status: 401, code: 'RSVP_ACCOUNT_REQUIRED' });
  });
});

describe('RSVP service: recording an answer', () => {
  it('binds the seat to the responding account as it writes the status', async () => {
    const updated = invitation({
      guest: guestRow({ rsvp_status: 'maybe', rsvp_responded_at: now, revision: 2, user_id: 'user-1' }),
    });
    const fixture = databaseWithRows(invitation(), updated);
    const response = await fixture.service.update({ token, status: 'maybe', expectedRevision: 1 }, invitee);

    expect(fixture.guest.updateMany).toHaveBeenCalledWith({
      where: { id: 'guest-1', event_id: 'event-1', revision: 1 },
      data: {
        rsvp_status: 'maybe',
        rsvp_responded_at: now,
        revision: { increment: 1 },
        user_id: 'user-1',
      },
    });
    expect(response.body.rsvp).toEqual({
      status: 'maybe',
      revision: 2,
      respondedAt: now.toISOString(),
      requiresAccount: true,
      claimed: true,
      invitedEmailHint: INVITED_HINT,
    });
  });

  it('replays the same state without rewriting its response timestamp', async () => {
    const firstResponseAt = new Date('2029-12-20T10:00:00.000Z');
    const current = invitation({
      guest: guestRow({
        rsvp_status: 'accepted',
        rsvp_responded_at: firstResponseAt,
        revision: 4,
        user_id: 'user-1',
      }),
    });
    const fixture = databaseWithRows(current);
    const response = await fixture.service.update(
      { token, status: 'accepted', expectedRevision: 1 },
      invitee,
    );

    expect(response.body.rsvp.status).toBe('accepted');
    expect(response.body.rsvp.revision).toBe(4);
    expect(response.body.rsvp.respondedAt).toBe(firstResponseAt.toISOString());
    expect(fixture.guest.updateMany).not.toHaveBeenCalled();
  });

  it('still writes when the status is unchanged but the seat is unbound', async () => {
    // The early return above is keyed on status alone. A guest who answered
    // under the old anonymous contract and then signs in must still have their
    // seat attributed, or it stays unattributed for the life of the record.
    const current = invitation({
      guest: guestRow({ rsvp_status: 'accepted', rsvp_responded_at: now, revision: 4, user_id: null }),
    });
    const bound = invitation({
      guest: guestRow({ rsvp_status: 'accepted', rsvp_responded_at: now, revision: 5, user_id: 'user-1' }),
    });
    const fixture = databaseWithRows(current, bound);

    await fixture.service.update({ token, status: 'accepted', expectedRevision: 4 }, invitee);

    expect(fixture.guest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ user_id: 'user-1' }),
    }));
  });

  it('rejects a different state submitted against a stale revision', async () => {
    const current = invitation({
      guest: guestRow({ rsvp_status: 'accepted', rsvp_responded_at: now, revision: 3, user_id: 'user-1' }),
    });
    const fixture = databaseWithRows(current);

    await expect(fixture.service.update({ token, status: 'declined', expectedRevision: 2 }, invitee))
      .rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
    expect(fixture.guest.updateMany).not.toHaveBeenCalled();
  });
});

describe('RSVP service: invitations issued before the rule', () => {
  const grandfathered = () => invitation({ requires_account: false });

  it('accepts an anonymous answer', async () => {
    const updated = invitation({
      requires_account: false,
      guest: guestRow({ rsvp_status: 'accepted', rsvp_responded_at: now, revision: 2 }),
    });
    const fixture = databaseWithRows(grandfathered(), updated);

    const response = await fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, null);

    expect(response.status).toBe(200);
    expect(response.body.rsvp.requiresAccount).toBe(false);
    // No binding to make: nobody presented an account.
    expect(fixture.guest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { rsvp_status: 'accepted', rsvp_responded_at: now, revision: { increment: 1 } },
    }));
  });

  it('binds opportunistically when the invited account happens to answer', async () => {
    const updated = invitation({
      requires_account: false,
      guest: guestRow({ rsvp_status: 'accepted', rsvp_responded_at: now, revision: 2, user_id: 'user-1' }),
    });
    const fixture = databaseWithRows(grandfathered(), updated);

    await fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, invitee);

    expect(fixture.guest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ user_id: 'user-1' }),
    }));
  });

  it('does not bind a signed-in stranger, and does not block them either', async () => {
    // A grandfathered link is a bearer credential; a signed-in stranger holding
    // it is no more privileged than an anonymous one holding it. What must not
    // happen is the seat being attributed to the wrong person.
    const updated = invitation({
      requires_account: false,
      guest: guestRow({ rsvp_status: 'declined', rsvp_responded_at: now, revision: 2 }),
    });
    const fixture = databaseWithRows(grandfathered(), updated);

    const response = await fixture.service.update(
      { token, status: 'declined', expectedRevision: 1 },
      stranger,
    );

    expect(response.status).toBe(200);
    expect(fixture.guest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { rsvp_status: 'declined', rsvp_responded_at: now, revision: { increment: 1 } },
    }));
  });
});
