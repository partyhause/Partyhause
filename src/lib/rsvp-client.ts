import { apiPost, apiPut } from './api-client';

export type BrowserRsvpStatus = 'pending' | 'accepted' | 'maybe' | 'declined';
export type BrowserRsvpChoice = Exclude<BrowserRsvpStatus, 'pending'>;

export interface BrowserRsvpInvitation {
  event: {
    name: string;
    hostName: string;
    start: string;
    end: string;
    timezone: string;
    location: string;
  };
  rsvp: {
    status: BrowserRsvpStatus;
    revision: number;
    respondedAt: string | null;
    /**
     * False only for invitations issued before RSVP required an account, which
     * keep answering anonymously until they expire. The page branches on this
     * rather than on whether a session exists, because the server is the one
     * that knows which contract a given invitation was issued under.
     */
    requiresAccount: boolean;
    /** True once an account has claimed this seat. */
    claimed: boolean;
    /** Masked invited address, e.g. `a****@example.com`. */
    invitedEmailHint: string;
  };
}

export interface BrowserRsvpError {
  status?: number;
  code?: string;
  message: string;
}

export interface BrowserRsvpResult {
  data: BrowserRsvpInvitation | null;
  error: BrowserRsvpError | null;
}

/**
 * Issue one RSVP call.
 *
 * THE TWO CALLS HAVE DIFFERENT POSTURES, DELIBERATELY
 * `POST /resolve` is `anonymous`: it must work with no session, because an
 * invitee has to be able to read what they are being invited to before
 * deciding to create an account for it. `PUT /` is `privacy`: it sends the
 * session, because recording a response now requires the invited account, but
 * it keeps the same three hardening options.
 *
 * Those options are not incidental on either call. The token sits in the page
 * URL, so without `no-referrer` it travels in a Referer header to anything the
 * page links to, and without `no-store` it sits in a shared cache. Sending it
 * as `anonymous` once the endpoint requires auth would strip the Authorization
 * header and produce a guaranteed 401, which is why `privacy` exists as a
 * separate flag rather than being folded into `anonymous`.
 *
 * @param method POST resolves a token, PUT submits a response.
 * @param body The request body.
 * @returns The invitation, or a structured error. Never throws.
 */
async function request(method: 'POST' | 'PUT', body: Record<string, unknown>): Promise<BrowserRsvpResult> {
  const path = method === 'POST' ? '/api/rsvp/resolve' : '/api/rsvp';
  const { data, error } =
    method === 'POST'
      ? await apiPost<BrowserRsvpInvitation>(path, body, { anonymous: true })
      : await apiPut<BrowserRsvpInvitation>(path, body, { privacy: true });

  if (error) {
    return {
      data: null,
      error: {
        status: error.status,
        code: error.code,
        message: error.message || 'The invitation request failed',
      },
    };
  }
  return { data, error: null };
}

/** Resolve an RSVP token without changing its guest record. */
export function resolveRsvp(token: string): Promise<BrowserRsvpResult> {
  return request('POST', { token });
}

/** Submit one explicit response against the revision returned by resolve. */
export function submitRsvp(
  token: string,
  status: BrowserRsvpChoice,
  expectedRevision: number,
): Promise<BrowserRsvpResult> {
  return request('PUT', { token, status, expectedRevision });
}
