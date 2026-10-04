/**
 * Account summary and permanent deletion, for the web client.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN IMPORT
 * `packages/core` already carries `createAccountResource` with this exact
 * flow, and mobile uses it. The web app does not consume that package
 * (AGENTS.md records the two-client split), so the choice was to duplicate the
 * four calls or to migrate the web client, and a settings screen is the wrong
 * place to attempt the migration. Treat this as one of the two sites any
 * account-contract change has to touch.
 *
 * WHY THE WEB NEEDED IT AT ALL
 * The server routes, the shared resource and the mobile screen were all
 * complete; `src/` had no deletion control of any kind. App Store guideline
 * 5.1.1(v) binds only the iOS app, so this was never a submission blocker, but
 * a user who registered on the web could not delete their account from the
 * web. RSVP now creates an account for every guest, so that population is
 * about to grow by an order of magnitude.
 *
 * THE FLOW IS TWO STEPS ON PURPOSE
 * `deletion-intent` re-authenticates with the current password and returns a
 * receipt that expires. `deletion` consumes that receipt plus a typed
 * confirmation word. A single irreversible button behind a session that may
 * have been left open on a shared machine is not a confirmation.
 */

import { apiGet, apiPost } from './api-client';

/** The word the server demands, verbatim. Compared case-sensitively. */
export const DELETION_CONFIRMATION_WORD = 'DELETE';

export type AccountDeletionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AccountDeletion {
  receipt: string;
  status: AccountDeletionStatus;
  requestedAt: string;
  eraseBy: string;
  completedAt: string | null;
  confirmationExpiresAt: string | null;
  retryable: boolean;
}

export interface AccountSummary {
  account: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    createdAt: string;
  };
  legal: {
    termsVersion: string;
    privacyVersion: string;
    effectiveDate: string;
    acceptedTermsVersion: string | null;
    acceptedPrivacyVersion: string | null;
    ageEligible: boolean;
    minimumAge: number;
    urls: { privacy: string; terms: string; support: string };
  };
}

/**
 * Either the value, or a message already fit to render plus the raw code.
 *
 * `code` is carried alongside the rendered message because two callers need
 * different things from the same failure: the view renders `error`, while the
 * flow has to ask {@link receiptIsDead} whether to send the user back to the
 * password step. Returning only the message forces the caller to match on
 * prose, which breaks the moment the copy is edited.
 */
export interface AccountResult<T> {
  data: T | null;
  /** Rendered copy, already fit to show. Null on success. */
  error: string | null;
  /**
   * The raw server code, when there was one.
   *
   * Carried alongside the rendered message because two callers want different
   * things from one failure: the view renders `error`, while the flow asks
   * {@link receiptIsDead} whether to send the user back to the password step.
   * Matching on prose instead would break the moment the copy is edited.
   */
  code?: string;
}

/**
 * Turn a server error code into copy that names the remedy.
 *
 * Mirrors `describeDeletionError` in apps/mobile/app/settings/index.tsx. The
 * codes come from server/lib/account.ts. A raw code shown to a user is a
 * support ticket, and "something went wrong" on an irreversible action is
 * worse, because the user cannot tell whether it happened.
 */
export function describeDeletionError(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'PASSWORD_REQUIRED':
      return 'Enter your current password to continue.';
    case 'PASSWORD_REAUTH_FAILED':
      return 'That password is not correct. Nothing has been deleted.';
    case 'ACCOUNT_NOT_ACTIVE':
      return 'This account cannot be deleted right now. Contact support if that seems wrong.';
    case 'DELETION_CONFIRMATION_INVALID':
      return `Type ${DELETION_CONFIRMATION_WORD} exactly, in capitals.`;
    case 'DELETION_CONFIRMATION_EXPIRED':
      return 'That confirmation window closed. Start again with your password.';
    case 'DELETION_RECEIPT_NOT_FOUND':
    case 'DELETION_STATE_INVALID':
      return 'That request is no longer valid. Start again with your password.';
    case 'DELETION_RATE_LIMITED':
      return 'Too many attempts. Wait a few minutes and try again.';
    default:
      return fallback;
  }
}

/**
 * True when the held receipt can no longer be used and the flow must restart.
 *
 * Keeping a dead receipt on screen offers the user a confirm button that can
 * only fail, so the caller sends them back to the password step instead.
 */
export function receiptIsDead(code: string | undefined): boolean {
  return (
    code === 'DELETION_CONFIRMATION_EXPIRED'
    || code === 'DELETION_RECEIPT_NOT_FOUND'
    || code === 'DELETION_STATE_INVALID'
  );
}

export const accountService = {
  /** Read the account and the legal versions it has accepted. */
  summary: async (): Promise<AccountResult<AccountSummary>> => {
    const { data, error } = await apiGet<AccountSummary>('/api/mvp/account');
    if (error || !data) {
      return { data: null, error: error?.message ?? 'Your account could not be loaded.', code: error?.code };
    }
    return { data, error: null };
  },

  /**
   * Re-authenticate and obtain a deletion receipt.
   *
   * @param password The account's current password.
   * @returns The receipt, or copy naming why it was refused.
   */
  createDeletionIntent: async (password: string): Promise<AccountResult<AccountDeletion>> => {
    const { data, error } = await apiPost<{ deletion?: AccountDeletion }>(
      '/api/mvp/account/deletion-intent',
      { password },
    );
    if (error || !data?.deletion) {
      return {
        data: null,
        error: describeDeletionError(error?.code, error?.message ?? 'The request could not be started.'),
        code: error?.code,
      };
    }
    return { data: data.deletion, error: null };
  },

  /**
   * Consume the receipt and erase the account.
   *
   * Sent anonymously, matching packages/core/src/resources/account.ts:62. The
   * route does not authenticate, and by the time this resolves the session it
   * would have carried is being destroyed, so attaching one only creates a
   * request whose credential is invalidated mid-flight.
   *
   * @param receipt The receipt from {@link accountService.createDeletionIntent}.
   * @param confirmation What the user typed. Sent as-is so the server, not the
   *        client, decides whether it matches.
   */
  confirmDeletion: async (
    receipt: string,
    confirmation: string,
  ): Promise<AccountResult<AccountDeletion>> => {
    const { data, error } = await apiPost<{ accepted: true; deletion: AccountDeletion }>(
      '/api/mvp/account/deletion',
      { receipt, confirmation },
      { anonymous: true },
    );
    if (error || !data?.deletion) {
      return {
        data: null,
        error: describeDeletionError(error?.code, error?.message ?? 'The account could not be deleted.'),
        code: error?.code,
      };
    }
    return { data: data.deletion, error: null };
  },
};
