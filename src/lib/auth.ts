import { getStoredToken, setStoredToken, getStoredUser, setStoredUser, clearAuth } from './auth-storage';
import { apiGet, apiPost } from './api-client';
import type { SignupConsent } from './legal';
export type { SignupConsent } from './legal';

export interface AuthResponse {
  success: boolean;
  user?: { id: string; email: string; name?: string } | null;
  error?: string;
  message?: string;
  /**
   * True when the account exists and the password was correct, but the address
   * has not been confirmed. The caller should offer to resend the link rather
   * than treat this as a credential failure: sending the user to password
   * reset cannot resolve it.
   */
  needsEmailVerification?: boolean;
  /** Set when signup succeeded but no session was established. */
  awaitingVerification?: boolean;
}

/**
 * Error carrying the server's machine-readable `code` alongside its message.
 *
 * The plain `new Error(data.error)` this replaces discarded the code, so a
 * caller could not tell an unconfirmed address (403 EMAIL_NOT_VERIFIED) from a
 * wrong password (401). They need opposite responses: one offers to resend a
 * link, the other offers a password reset.
 */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * POST an auth endpoint, throwing `AuthApiError` on a non-2xx.
 *
 * Goes through the shared client now rather than a bare fetch. The only thing
 * that ever justified a separate transport here was the error `code`: the old
 * web client discarded it, keeping just `{message, status}`, so this file
 * reimplemented the request path to read `data.code` and tell a 403
 * EMAIL_NOT_VERIFIED from a 401 bad password. The shared envelope carries
 * `code`, so the reimplementation is gone and the throwing contract its
 * callers rely on is preserved here.
 *
 * @param path The auth route.
 * @param body JSON body.
 * @param authenticated Whether to attach the stored bearer token. False for
 *        every credential endpoint: the server ignores a token on login, and
 *        sending one would make the transport read a 401 (bad password) as a
 *        revoked session and sign the user out mid-login.
 * @throws AuthApiError carrying status and code.
 */
async function apiPostAuth<T>(path: string, body: unknown, authenticated = false): Promise<T> {
  const { data, error } = await apiPost<T>(path, body, { anonymous: !authenticated });
  if (error) {
    throw new AuthApiError(error.message, error.status ?? 0, error.code);
  }
  return data as T;
}

/**
 * GET an authenticated auth endpoint.
 *
 * @throws AuthApiError carrying status and code.
 */
async function apiGetAuth<T>(path: string): Promise<T> {
  const { data, error } = await apiGet<T>(path);
  if (error) {
    throw new AuthApiError(error.message, error.status ?? 0, error.code);
  }
  return data as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Authentication request failed';
}

export const handleAuthError = async () => {
  clearAuth();
  window.location.href = '/auth/login';
  return true;
};

export const initializeAuthStateListener = () => {
  const token = getStoredToken();
  if (!token) return;
  // Verify token is still valid on init
  apiGetAuth<{ id: string; email: string; name?: string }>('/api/auth/me').catch(() => {
    clearAuth();
  });
};

export const authService = {
  signIn: async (email: string, password: string): Promise<AuthResponse> => {
    try {
      const data = await apiPostAuth<{ user: { id: string; email: string; name?: string }; token: string }>(
        '/api/auth/login', { email, password },
      );
      setStoredToken(data.token);
      setStoredUser(data.user);
      return { success: true, user: data.user };
    } catch (error: unknown) {
      // An unconfirmed address is not a credential failure. Surfacing it as
      // one sends the user to password reset, which cannot help: the password
      // was correct.
      if (error instanceof AuthApiError && error.code === 'EMAIL_NOT_VERIFIED') {
        return {
          success: false,
          needsEmailVerification: true,
          error: error.message,
        };
      }
      return { success: false, error: errorMessage(error) };
    }
  },

  /**
   * Create an account. Does NOT sign the user in.
   *
   * The route returns no token until the address is confirmed, so nothing is
   * stored here. Reading `data.token` and calling `setStoredToken` on it, as
   * this did, now writes `undefined` and leaves a half-signed-in state that
   * every later request rejects.
   */
  signUp: async (
    email: string,
    password: string,
    name: string,
    consent: SignupConsent,
  ): Promise<AuthResponse> => {
    try {
      const data = await apiPostAuth<{
        user: { id: string; email: string; name?: string };
        message: string;
      }>('/api/auth/signup', { email, password, name, ...consent });

      return {
        success: true,
        user: data.user,
        awaitingVerification: true,
        message: data.message ?? 'Check your email for a confirmation link before signing in.',
      };
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) };
    }
  },

  /**
   * Create an account from an invitation, and DO sign the user in.
   *
   * The only signup path that establishes a session, because it is the only one
   * where the address is already proven: the invitation token was mailed to it,
   * and the server re-checks that the token resolves to this exact address
   * before it returns anything. Without this the invitee would have to leave
   * for their inbox a second time, having arrived from it, purely to confirm
   * an address the link already confirmed.
   *
   * Writes BOTH storage keys. `src/hooks/use-auth.ts` hydrates only when the
   * token and the cached user are both present, so writing one without the
   * other yields a session the app renders as signed out.
   *
   * @param inviteToken The 43-character token from the /join/:token URL.
   * @returns success with the user, or the server's reason for refusing.
   */
  signUpWithInvitation: async (
    email: string,
    password: string,
    name: string,
    consent: SignupConsent,
    inviteToken: string,
  ): Promise<AuthResponse> => {
    try {
      const data = await apiPostAuth<{
        user: { id: string; email: string; name?: string };
        token: string;
        message?: string;
      }>('/api/auth/signup', { email, password, name, ...consent, inviteToken });

      // A server that declined to auto-verify returns no token. Storing an
      // undefined one would leave the half-written session described above,
      // so fall back to reporting that confirmation is still outstanding.
      if (!data.token) {
        return {
          success: true,
          user: data.user,
          awaitingVerification: true,
          message: data.message ?? 'Check your email for a confirmation link before signing in.',
        };
      }

      setStoredToken(data.token);
      setStoredUser(data.user);
      return { success: true, user: data.user, message: data.message };
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) };
    }
  },

  /**
   * Re-send the confirmation link. Anonymous, because a user who cannot sign in
   * has no session to authenticate with. The server answers identically whether
   * or not the address is registered, so this cannot confirm an account exists.
   */
  resendVerification: async (email: string): Promise<AuthResponse> => {
    try {
      const data = await apiPostAuth<{ success: boolean; message: string }>(
        '/api/auth/resend-verification', { email },
      );
      return { success: true, message: data.message };
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) };
    }
  },

  resetPassword: async (email: string): Promise<AuthResponse> => {
    try {
      // Requesting a reset link is /forgot-password; /reset-password is the
      // second step and requires { token, email, password }.
      await apiPostAuth('/api/auth/forgot-password', { email });
      return {
        success: true,
        message: 'If an active account exists and delivery succeeds, reset instructions will arrive shortly.',
      };
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) };
    }
  },

  signOut: async (): Promise<AuthResponse> => {
    try {
      await apiPostAuth('/api/auth/logout', {}, true);
    } catch {
      // Ignore — discard token either way
    }
    clearAuth();
    return { success: true, message: 'Successfully signed out' };
  },

  getCurrentUser: async () => {
    return getStoredUser();
  },

  getAccessToken: async (): Promise<string | null> => {
    return getStoredToken();
  },

  /**
   * Complete the email-verification loop using the token + email from the
   * link the API emailed (or logged, in dev) at signup.
   */
  verifyEmail: async (email: string, token: string): Promise<AuthResponse> => {
    try {
      const data = await apiPostAuth<{ success: boolean; message: string }>(
        '/api/auth/verify-email', { email, token },
      );
      return { success: true, message: data.message };
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) };
    }
  },
};
