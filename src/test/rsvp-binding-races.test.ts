/**
 * RSVP seat binding: the lost race, the unique index, and the address hint.
 *
 * WHY THIS IS A SEPARATE FILE FROM rsvp-service.test.ts
 *   That file covers the `resolveBinding` decision matrix thoroughly, seventeen
 *   cases, every branch of who may answer. These three paths are the ones it
 *   does not reach, and they were written while that file was being actively
 *   edited by another process. A second file collides with nobody. If the two
 *   are ever merged, this header is the only thing worth dropping.
 *
 * WHAT IS BEING COVERED, AND WHY EACH ONE MATTERS
 *
 *   1. `resolveConcurrentUpdate` re-authorization. The hardest path in the
 *      change and the least likely to be exercised by hand. When the
 *      compare-and-swap loses, the row is re-read and authorization is checked
 *      *again*, because the winning write may have bound the seat to a
 *      different account. Without that re-check the loser is handed a 200 and
 *      an invitation body for a response that was never recorded, which is the
 *      worst failure shape available here: silent, and it looks like success.
 *
 *   2. `mapRsvpError` and `guests_event_id_user_id_key`. The unique index is
 *      what actually stops one account holding two seats at one event. Its
 *      error mapping depends on the shape of Prisma's `meta.target`, which is
 *      an array for some errors and a bare string for a named Postgres index.
 *      The mapping handles both, and nothing proved it.
 *
 *   3. `maskEmail` degenerate inputs. The hint is returned by the
 *      unauthenticated `resolve`, so its failure mode is disclosure.
 */

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { MvpError } from '../../server/lib/mvp-contract';
import { RsvpService, type RsvpActor } from '../../server/lib/rsvp';

const now = new Date('2030-01-01T00:00:00.000Z');
const token = Buffer.alloc(32, 7).toString('base64url');

const INVITED_EMAIL = 'guest@example.com';
const invitee: RsvpActor = { id: 'user-1', email: INVITED_EMAIL };
const rival: RsvpActor = { id: 'user-9', email: INVITED_EMAIL };

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

/**
 * A database whose compare-and-swap loses.
 *
 * `updateMany` reports `count: 0`, which is how the service learns a competing
 * transaction moved the revision first. The rows are served in order: the read
 * before the write, then the re-read inside `resolveConcurrentUpdate`.
 */
function databaseLosingTheRace(
  rows: Array<ReturnType<typeof invitation>>,
  updateError?: unknown,
) {
  const guestInvitation = { findUnique: vi.fn() };
  for (const row of rows) guestInvitation.findUnique.mockResolvedValueOnce(row);
  const guest = {
    updateMany: updateError
      ? vi.fn().mockRejectedValue(updateError)
      : vi.fn().mockResolvedValue({ count: 0 }),
  };
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'invitation-1' }]),
    guestInvitation,
    guest,
  };
  const database = {
    ...transaction,
    $transaction: vi.fn(async (work: (client: typeof transaction) => Promise<unknown>) => work(transaction)),
  } as unknown as PrismaClient;
  return { database, guest, service: new RsvpService(database, () => now) };
}

describe('losing the compare-and-swap', () => {
  it('refuses the loser when the winner bound the seat to another account', async () => {
    // Two accounts hold the same invited address, which is reachable when a
    // host invites someone who then signs up twice, or when a link is
    // forwarded. `rival` wins the write and claims the seat; `invitee` must not
    // be told their answer was recorded.
    const before = invitation();
    const afterRivalWon = invitation({
      guest: guestRow({ user_id: rival.id, rsvp_status: 'accepted', revision: 2 }),
    });
    const fixture = databaseLosingTheRace([before, afterRivalWon]);

    await expect(
      fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, invitee),
    ).rejects.toMatchObject({ status: 409, code: 'RSVP_ALREADY_CLAIMED' });
  });

  it('does not report success for a response it never recorded', async () => {
    // The specific trap the re-check closes. The winner stored the very status
    // this caller asked for, so the pre-existing "same status, return 200"
    // branch would answer 200 with a valid-looking invitation body. It is the
    // wrong answer: this caller may not respond at all.
    const before = invitation();
    const afterRivalWon = invitation({
      guest: guestRow({ user_id: rival.id, rsvp_status: 'accepted', revision: 2 }),
    });
    const fixture = databaseLosingTheRace([before, afterRivalWon]);

    const outcome = await fixture.service
      .update({ token, status: 'accepted', expectedRevision: 1 }, invitee)
      .then(
        (response) => ({ kind: 'resolved' as const, status: response.status }),
        (error: unknown) => ({ kind: 'rejected' as const, status: (error as MvpError).status }),
      );

    expect(outcome.kind).toBe('rejected');
    expect(outcome.status).not.toBe(200);
  });

  it('still replays a 200 when the winner recorded this caller\'s own answer', async () => {
    // Same race, legitimate outcome: the competing write was this same account,
    // most likely the user's own retry. Rejecting here would turn a duplicate
    // tap into an error for a response that is genuinely stored.
    const before = invitation();
    const afterOwnWriteWon = invitation({
      guest: guestRow({ user_id: invitee.id, rsvp_status: 'accepted', revision: 2 }),
    });
    const fixture = databaseLosingTheRace([before, afterOwnWriteWon]);

    const response = await fixture.service.update(
      { token, status: 'accepted', expectedRevision: 1 },
      invitee,
    );

    expect(response.status).toBe(200);
    expect(response.body.rsvp).toMatchObject({ status: 'accepted', claimed: true });
  });

  it('reports a revision conflict when the winner stored a different answer', async () => {
    const before = invitation();
    const afterOwnWriteWon = invitation({
      guest: guestRow({ user_id: invitee.id, rsvp_status: 'declined', revision: 2 }),
    });
    const fixture = databaseLosingTheRace([before, afterOwnWriteWon]);

    await expect(
      fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, invitee),
    ).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
  });
});

describe('the one-seat-per-account index', () => {
  /** Prisma's unique-violation shape. `target` varies by error and version. */
  function uniqueViolation(target: unknown) {
    return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
  }

  it('names the seat collision when target is a bare index string', async () => {
    // What Postgres reports for a named index, and the shape most likely to
    // arrive from `guests_event_id_user_id_key`.
    const fixture = databaseLosingTheRace(
      [invitation()],
      uniqueViolation('guests_event_id_user_id_key'),
    );

    await expect(
      fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, invitee),
    ).rejects.toMatchObject({ status: 409, code: 'RSVP_SEAT_ALREADY_HELD' });
  });

  it('names the seat collision when target is a field array', async () => {
    const fixture = databaseLosingTheRace(
      [invitation()],
      uniqueViolation(['event_id', 'user_id']),
    );

    await expect(
      fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, invitee),
    ).rejects.toMatchObject({ status: 409, code: 'RSVP_SEAT_ALREADY_HELD' });
  });

  it('leaves the invited-address collision to its own code', async () => {
    // guests_event_id_normalized_email_key is a different invariant with a
    // different remedy. Hijacking it would tell a guest they already hold a
    // seat when the real problem is a duplicated address on the guest list.
    const fixture = databaseLosingTheRace(
      [invitation()],
      uniqueViolation('guests_event_id_normalized_email_key'),
    );

    await expect(
      fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, invitee),
    ).rejects.toMatchObject({ status: 409, code: 'GUEST_EMAIL_EXISTS' });
  });

  it('does not claim unrelated unique violations', async () => {
    const fixture = databaseLosingTheRace([invitation()], uniqueViolation(['some_other_column']));

    await expect(
      fixture.service.update({ token, status: 'accepted', expectedRevision: 1 }, invitee),
    ).rejects.toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
  });
});

describe('the invited-address hint', () => {
  function resolveWith(normalized_email: string) {
    const guestInvitation = { findUnique: vi.fn().mockResolvedValue(invitation({ guest: guestRow({ normalized_email }) })) };
    const database = { guestInvitation } as unknown as PrismaClient;
    return new RsvpService(database, () => now).resolve({ token });
  }

  it('keeps one leading character and the domain', async () => {
    const response = await resolveWith('alexandra@example.com');
    expect(response.body.rsvp.invitedEmailHint).toBe('a********@example.com');
  });

  it('masks a single-character local part without revealing its length', async () => {
    // One star minimum, so `a@x.com` does not advertise that the local part is
    // exactly one character long.
    const response = await resolveWith('a@example.com');
    expect(response.body.rsvp.invitedEmailHint).toBe('a*@example.com');
  });

  it('masks entirely when there is no local part to keep', async () => {
    const response = await resolveWith('@example.com');
    expect(response.body.rsvp.invitedEmailHint).toBe('****');
  });

  it('masks entirely when the value is not an address at all', async () => {
    const response = await resolveWith('not-an-address');
    expect(response.body.rsvp.invitedEmailHint).toBe('****');
  });

  it('splits on the last @, so a quoted local part cannot leak', async () => {
    // Local part is `a@b`, three characters, so one kept and two masked. The
    // split is on the last `@` rather than the first, which is what stops an
    // address like this exposing its domain-looking middle section.
    const response = await resolveWith('a@b@example.com');
    expect(response.body.rsvp.invitedEmailHint).toBe('a**@example.com');
  });
});
