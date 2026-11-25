import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

import { mapMvpDatabaseError } from './mvp-command';
import { MvpError, type MvpHttpResponse } from './mvp-contract';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RSVP_STATUSES = ['accepted', 'maybe', 'declined'] as const;
export type PublicRsvpStatus = (typeof RSVP_STATUSES)[number];

/**
 * The identity behind an RSVP write, or null for an anonymous caller.
 *
 * Supplied by the route from `req.user`, which middleware/auth.ts only
 * populates for a token that is signed, unexpired, at the current epoch, on an
 * active account, and email-verified. This module therefore treats a non-null
 * actor as already verified and does not re-check it.
 */
export interface RsvpActor {
  id: string;
  email: string;
}

export interface PublicRsvpInvitation {
  event: {
    name: string;
    hostName: string;
    start: string;
    end: string;
    timezone: string;
    location: string;
  };
  rsvp: {
    status: 'pending' | PublicRsvpStatus;
    revision: number;
    respondedAt: string | null;
    /** False only for invitations issued before RSVP required an account. */
    requiresAccount: boolean;
    /** True once an account has claimed this seat. */
    claimed: boolean;
    /** Masked invited address, e.g. `a****@example.com`. See maskEmail. */
    invitedEmailHint: string;
  };
}

interface InvitationRow {
  event_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  requires_account: boolean;
  event: {
    id: string;
    name: string;
    start_date: Date;
    end_date: Date;
    timezone: string | null;
    location: string;
    status: string;
    privacy: string;
    is_public: boolean;
    cancelled_at: Date | null;
    host: { name: string | null; account_status: string };
  };
  guest: {
    id: string;
    event_id: string;
    rsvp_status: string;
    rsvp_responded_at: Date | null;
    revision: number;
    normalized_email: string;
    user_id: string | null;
  };
}

interface ParsedRsvpUpdate {
  token: string;
  status: PublicRsvpStatus;
  expectedRevision: number;
}

const INVITATION_SELECT = {
  event_id: true,
  expires_at: true,
  revoked_at: true,
  requires_account: true,
  event: {
    select: {
      id: true,
      name: true,
      start_date: true,
      end_date: true,
      timezone: true,
      location: true,
      status: true,
      privacy: true,
      is_public: true,
      cancelled_at: true,
      host: { select: { name: true, account_status: true } },
    },
  },
  guest: {
    select: {
      id: true,
      event_id: true,
      rsvp_status: true,
      rsvp_responded_at: true,
      revision: true,
      normalized_email: true,
      user_id: true,
    },
  },
} satisfies Prisma.GuestInvitationSelect;

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MvpError(400, 'INVALID_REQUEST', 'Request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function exactKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(body, key))) {
    throw new MvpError(400, 'UNKNOWN_FIELDS', 'Request body contains unsupported fields');
  }
}

function tokenHash(value: unknown): string {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw unavailable();
  }
  return createHash('sha256').update(value).digest('hex');
}

function unavailable(): MvpError {
  return new MvpError(404, 'RSVP_UNAVAILABLE', 'This invitation is unavailable');
}

/**
 * Normalize an address the same way PostgreSQL does.
 *
 * `guests.normalized_email` is maintained by a trigger as `lower(btrim(email))`
 * and a CHECK constraint holds it to exactly that, so the comparison in
 * {@link resolveBinding} is only sound if this agrees with it. `trim()` also
 * strips tabs and newlines where `btrim` strips spaces, which is stricter and
 * cannot produce a false match.
 */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Reduce an address to a recognisable hint.
 *
 * WHY NOT THE FULL ADDRESS
 * Strict matching means a guest who signs up with the wrong one of their
 * addresses gets a 403 and no way to work out which address was invited, so
 * the client needs to show something. Echoing the address in full would hand
 * it to anyone holding a forwarded link, and since signup with a valid token
 * auto-verifies a matching address, that is the one piece of information an
 * attacker would need. A hint is enough for the real invitee to recognise
 * their own address and not enough for anyone else to type it blind.
 *
 * @param email A normalized address. Values with no `@` are fully masked.
 */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '****';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local[0]}${'*'.repeat(Math.max(local.length - 1, 1))}${domain}`;
}

/** Parse the read-only token resolution request without exposing token diagnostics. */
export function parseRsvpResolve(value: unknown): string {
  const body = bodyRecord(value);
  exactKeys(body, ['token']);
  return tokenHash(body.token);
}

/** Parse a revision-bound RSVP update. */
export function parseRsvpUpdate(value: unknown): ParsedRsvpUpdate {
  const body = bodyRecord(value);
  exactKeys(body, ['token', 'status', 'expectedRevision']);
  if (!RSVP_STATUSES.includes(body.status as PublicRsvpStatus)) {
    throw new MvpError(400, 'INVALID_RSVP_STATUS', 'status must be accepted, maybe, or declined');
  }
  if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) {
    throw new MvpError(400, 'INVALID_REVISION', 'expectedRevision must be a positive integer');
  }
  return {
    token: tokenHash(body.token),
    status: body.status as PublicRsvpStatus,
    expectedRevision: body.expectedRevision as number,
  };
}

function validInvitation(row: InvitationRow | null, now: Date): InvitationRow {
  const valid = row
    && row.revoked_at === null
    && row.expires_at.getTime() > now.getTime()
    && row.event.status === 'published'
    && row.event.privacy === 'private'
    && row.event.is_public === false
    && row.event.cancelled_at === null
    && row.event.end_date.getTime() > now.getTime()
    && row.event.host.account_status === 'active'
    && row.guest.event_id === row.event_id
    && row.event.id === row.event_id;
  if (!valid) throw unavailable();
  return row;
}

/**
 * Decide which account, if any, this RSVP binds the guest seat to.
 *
 * This is where "a guest must be a user to RSVP" is actually enforced. Three
 * outcomes, and the caller must treat a thrown error as the whole request
 * failing rather than falling back to an anonymous write:
 *
 *   - returns a user id: bind the seat to it (or confirm it is already bound)
 *   - returns null: a grandfathered invitation being answered anonymously
 *   - throws: the caller may not answer this invitation at all
 *
 * The email comparison is the security boundary. Without it any signed-in
 * account could claim any invitation whose token it obtained, which would make
 * the guest list a record of who holds a link rather than who was invited.
 *
 * @param row A validated invitation, locked FOR UPDATE by the caller.
 * @param actor The verified caller, or null when no session was presented.
 * @returns The user id to bind, or null to leave the seat unbound.
 * @throws MvpError 401 when an account is required and none was presented.
 * @throws MvpError 403 when the account's address is not the invited one.
 * @throws MvpError 409 when a different account already claimed the seat.
 */
function resolveBinding(row: InvitationRow, actor: RsvpActor | null): string | null {
  const invited = row.guest.normalized_email;
  const matches = actor !== null && normalizeEmail(actor.email) === invited;

  if (!row.requires_account) {
    // The default path, not a legacy one. `requires_account` defaults to false
    // because the app is iPhone-only at 1.0, so an account-required invitation
    // is one an Android guest can never answer.
    //
    // Anonymous remains valid until expires_at. If the caller happens to be
    // the invited account, bind opportunistically so the seat converts to a
    // real attendee rather than staying unattributed for the life of the link.
    // That is the whole upsell: the profile is created at the moment of
    // highest intent, just after somebody says yes, instead of being demanded
    // before they can.
    if (matches && (row.guest.user_id === null || row.guest.user_id === actor!.id)) {
      return actor!.id;
    }
    return null;
  }

  if (actor === null) {
    throw new MvpError(
      401,
      'RSVP_ACCOUNT_REQUIRED',
      'Sign in with the invited email address to respond to this invitation',
    );
  }
  if (!matches) {
    throw new MvpError(
      403,
      'RSVP_EMAIL_MISMATCH',
      'This invitation was sent to a different email address',
    );
  }
  if (row.guest.user_id !== null && row.guest.user_id !== actor.id) {
    throw new MvpError(
      409,
      'RSVP_ALREADY_CLAIMED',
      'Another account has already claimed this invitation',
    );
  }
  return actor.id;
}

function publicInvitation(row: InvitationRow): PublicRsvpInvitation {
  const status = row.guest.rsvp_status;
  if (status !== 'pending' && !RSVP_STATUSES.includes(status as PublicRsvpStatus)) {
    throw unavailable();
  }
  return {
    event: {
      name: row.event.name,
      hostName: row.event.host.name?.trim() || 'Your host',
      start: row.event.start_date.toISOString(),
      end: row.event.end_date.toISOString(),
      timezone: row.event.timezone || 'UTC',
      location: row.event.location,
    },
    rsvp: {
      status: status as PublicRsvpInvitation['rsvp']['status'],
      revision: row.guest.revision,
      respondedAt: row.guest.rsvp_responded_at?.toISOString() ?? null,
      requiresAccount: row.requires_account,
      claimed: row.guest.user_id !== null,
      invitedEmailHint: maskEmail(row.guest.normalized_email),
    },
  };
}

async function findInvitation(
  database: Pick<Prisma.TransactionClient, 'guestInvitation'>,
  hash: string,
): Promise<InvitationRow | null> {
  const row = await database.guestInvitation.findUnique({
    where: { token_hash: hash },
    select: INVITATION_SELECT,
  });
  return row as InvitationRow | null;
}

async function lockInvitation(
  transaction: Prisma.TransactionClient,
  hash: string,
): Promise<void> {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT gi.id
    FROM guest_invitations gi
    JOIN events e ON e.id = gi.event_id
    JOIN guests g ON g.id = gi.guest_id
    JOIN users u ON u.id = e.host_id
    WHERE gi.token_hash = ${hash}
    FOR UPDATE OF gi, e, g, u
  `);
  if (locked.length === 0) throw unavailable();
}

/**
 * Translate a database failure, giving the seat-uniqueness index its own code.
 *
 * `guests_event_id_user_id_key` fires when one account tries to hold two seats
 * at one event, which happens when a host invited the same person twice under
 * two addresses and they answer both. mapMvpDatabaseError would call that
 * RESOURCE_CONFLICT, which tells the guest nothing; this names it so the client
 * can say they already have a seat.
 */
function mapRsvpError(error: unknown): MvpError {
  const mapped = mapMvpDatabaseError(error);
  if (mapped.status !== 409 || mapped.code !== 'RESOURCE_CONFLICT') return mapped;
  const target = (error as { meta?: { target?: unknown } })?.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  const joined = fields.join(',');
  if (joined.includes('user_id') && (joined.includes('event_id') || joined.includes('guests'))) {
    return new MvpError(
      409,
      'RSVP_SEAT_ALREADY_HELD',
      'This account already holds a place at this event',
    );
  }
  return mapped;
}

/** Anonymous-readable, account-bound RSVP reads and compare-and-swap updates. */
export class RsvpService {
  constructor(
    private readonly database: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Read an invitation without changing it.
   *
   * Deliberately unauthenticated. The invitee has to be able to see what they
   * are being asked to attend before deciding whether to create an account for
   * it; putting a sign-in wall in front of this would make the invitation
   * itself unreadable. Nothing here is writable and the address is masked.
   */
  async resolve(body: unknown): Promise<MvpHttpResponse<PublicRsvpInvitation>> {
    const hash = parseRsvpResolve(body);
    const row = validInvitation(await findInvitation(this.database, hash), this.clock());
    return { status: 200, body: publicInvitation(row) };
  }

  /**
   * Record one response, binding the seat to the responding account.
   *
   * @param body `{ token, status, expectedRevision }`, validated by parseRsvpUpdate.
   * @param actor The verified caller, or null when no session was presented.
   * @returns The invitation as it now stands, including its new revision.
   * @throws MvpError 401/403/409 from {@link resolveBinding}, 409 on a revision
   *   conflict, 404 when the invitation is not answerable.
   */
  async update(
    body: unknown,
    actor: RsvpActor | null,
  ): Promise<MvpHttpResponse<PublicRsvpInvitation>> {
    const input = parseRsvpUpdate(body);
    try {
      return await this.database.$transaction(async (transaction) => {
        const now = this.clock();
        await lockInvitation(transaction, input.token);
        const current = validInvitation(await findInvitation(transaction, input.token), now);

        // Before anything else: may this caller answer at all? An unauthorized
        // caller must not learn whether their guess at `status` was already the
        // stored value, so this precedes the idempotent early return below.
        const binding = resolveBinding(current, actor);
        const needsBinding = binding !== null && current.guest.user_id !== binding;

        if (current.guest.rsvp_status === input.status && !needsBinding) {
          return { status: 200, body: publicInvitation(current) };
        }
        if (current.guest.revision !== input.expectedRevision) {
          throw new MvpError(409, 'REVISION_CONFLICT', 'The RSVP was changed by another request');
        }
        const updated = await transaction.guest.updateMany({
          where: {
            id: current.guest.id,
            event_id: current.event_id,
            revision: input.expectedRevision,
          },
          data: {
            rsvp_status: input.status,
            rsvp_responded_at: now,
            revision: { increment: 1 },
            ...(needsBinding ? { user_id: binding } : {}),
          },
        });
        if (updated.count !== 1) {
          return this.resolveConcurrentUpdate(transaction, input, actor, now);
        }
        const confirmed = validInvitation(await findInvitation(transaction, input.token), now);
        return { status: 200, body: publicInvitation(confirmed) };
      });
    } catch (error) {
      throw mapRsvpError(error);
    }
  }

  private async resolveConcurrentUpdate(
    transaction: Prisma.TransactionClient,
    input: ParsedRsvpUpdate,
    actor: RsvpActor | null,
    now: Date,
  ): Promise<MvpHttpResponse<PublicRsvpInvitation>> {
    const latest = validInvitation(await findInvitation(transaction, input.token), now);
    // Re-check authorization against the row as it now stands. The competing
    // write may have bound the seat to a different account, which turns this
    // caller from authorized into not, and returning the invitation here would
    // report success for a response that was never recorded.
    const binding = resolveBinding(latest, actor);
    const bound = binding === null || latest.guest.user_id === binding;
    if (latest.guest.rsvp_status === input.status && bound) {
      return { status: 200, body: publicInvitation(latest) };
    }
    throw new MvpError(409, 'REVISION_CONFLICT', 'The RSVP was changed by another request');
  }
}
