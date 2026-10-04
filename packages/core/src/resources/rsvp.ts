import type { ApiResponse, Transport } from '../http/transport';

/**
 * Token-scoped RSVP: public to read, account-bound to answer.
 *
 * `resolve` is unauthenticated and must stay that way. An invitee has to be
 * able to see what they are being invited to before deciding whether to create
 * an account for it, so putting a session in front of the read would make the
 * invitation unreadable to exactly the people it is addressed to.
 *
 * `respond` is not. A guest must hold the invited account before their answer
 * is recorded, so it sends the session under `privacy` rather than `anonymous`:
 * same `no-referrer` / `no-store` / `credentials: omit` hardening, because the
 * token is still in the URL of the screen making the call, but with the
 * Authorization header attached. Sending it as `anonymous` would strip that
 * header and guarantee a 401.
 *
 * Invitations issued before this rule still answer without a session until
 * they expire. That is decided per invitation by the server and reported as
 * `rsvp.requiresAccount`; this client does not decide it.
 *
 * The web app reaches these same two endpoints through `src/lib/rsvp-client.ts`,
 * a standalone fetch wrapper written before this resource existed. That is the
 * repository's long-standing two-client problem, and this module is the shared
 * half. Mobile uses this; the web client should be retired onto it rather than a
 * third one being written.
 */

/** The three responses a guest may give. `pending` is a server state, not a choice. */
export type RsvpChoice = 'accepted' | 'maybe' | 'declined';

/** What the guest record currently says, including the un-answered state. */
export type RsvpStatus = 'pending' | RsvpChoice;

export interface RsvpInvitation {
  event: {
    name: string;
    hostName: string;
    /** ISO-8601. */
    start: string;
    /** ISO-8601. */
    end: string;
    timezone: string;
    location: string;
  };
  rsvp: {
    status: RsvpStatus;
    /**
     * Compare-and-swap counter. `respond` must echo the value that `resolve`
     * returned; the server answers 409 REVISION_CONFLICT if the record moved
     * in between, which is how two devices answering at once cannot silently
     * overwrite each other.
     */
    revision: number;
    respondedAt: string | null;
    /**
     * False only for invitations issued before RSVP required an account, which
     * keep answering anonymously until `expires_at`. Branch on this rather than
     * on whether a session exists: the server knows which contract a given
     * invitation was issued under and the client does not.
     */
    requiresAccount: boolean;
    /** True once an account has claimed this seat. */
    claimed: boolean;
    /** Masked invited address, e.g. `a****@example.com`. Never the full one. */
    invitedEmailHint: string;
  };
}

export interface RsvpResource {
  /** Read an invitation without changing it. */
  resolve(token: string): Promise<ApiResponse<RsvpInvitation>>;
  /**
   * Record one explicit response.
   *
   * @param token The invitation token from the link.
   * @param status The guest's choice.
   * @param expectedRevision The revision `resolve` last returned.
   */
  respond(
    token: string,
    status: RsvpChoice,
    expectedRevision: number,
  ): Promise<ApiResponse<RsvpInvitation>>;
}

/** Build the RSVP surface: public read, account-bound write. */
export function createRsvpResource(transport: Transport): RsvpResource {
  return {
    resolve: (token) =>
      transport.request<RsvpInvitation>('/api/rsvp/resolve', {
        method: 'POST',
        body: { token },
        anonymous: true,
      }),
    respond: (token, status, expectedRevision) =>
      transport.request<RsvpInvitation>('/api/rsvp', {
        method: 'PUT',
        // The service rejects unknown keys outright (`exactKeys`), so this
        // body carries exactly these three and nothing else.
        body: { token, status, expectedRevision },
        privacy: true,
      }),
  };
}
