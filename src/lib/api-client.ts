/**
 * The web app's HTTP client.
 *
 * WHAT CHANGED, AND WHY THE SIGNATURE DID NOT
 *   This file used to be a second, independently written implementation of
 *   `packages/core/src/http/transport.ts`. The two agreed on twelve things and
 *   disagreed on eighteen, and every disagreement was a place the web was
 *   worse. It is now a thin adapter: the transport is the shared one, and the
 *   five exported helpers keep the exact shapes they had, so none of the 51
 *   call sites change.
 *
 *   The whole reason a second client existed was one line. `createTransport`
 *   threw on an empty `baseUrl`, and `apiUrl()` returns a bare path when
 *   `VITE_API_URL` is unset, which is the normal same-origin deployment. That
 *   is fixed in the transport rather than worked around here.
 *
 * DEFECTS THIS CLOSES, EACH PREVIOUSLY LIVE
 *   - The response body was read outside the `try` (old `:150`), so a
 *     truncated response made `request()` reject. Every call site destructures
 *     `{ data, error }` and none of them catch, so that was an unhandled
 *     rejection at 51 sites.
 *   - A 401 wiped the session even when the request carried no token, so one
 *     401 from an anonymous endpoint signed the user out.
 *   - The session wipe was unconditional, so a stale 401 still in flight
 *     during a fresh login destroyed the new session. The shared transport
 *     compares the rejected token against the stored one first.
 *   - The error `code` was discarded, keeping only `{message, status}`. That
 *     is why `src/lib/auth.ts` exists as a separate client: it needs `code` to
 *     tell 403 EMAIL_NOT_VERIFIED from a 401. `code` is now carried, so that
 *     client can be retired next.
 *   - `apiDelete` took no body, so the web physically could not call the three
 *     routes that require one.
 *
 * WHAT IS DELIBERATELY UNCHANGED
 *   `redirectToLogin` still clears both localStorage keys and navigates. That
 *   behaviour is web-specific and correct; it is now injected as the
 *   transport's `onUnauthorized` rather than hardwired inside the request
 *   path, which also makes this module usable from a test without stubbing
 *   `window`.
 */

import { createTransport, type ApiResponse as CoreApiResponse } from '@partyhause/core';
import { getStoredToken, clearAuth } from './auth-storage';
import { getApiBaseUrl } from './apiBase';
import { recordApiCall } from '@/mcp/monitor';

/**
 * The envelope every helper returns.
 *
 * `code` is additive. Existing readers destructure `{ data, error }` and touch
 * only `message` and `status`, so nothing breaks by it being present.
 */
export interface ApiResponse<T = unknown> {
  data: T | null;
  error: { message: string; status?: number; code?: string } | null;
}

/**
 * Per-request options the shared transport already supports.
 *
 * `anonymous` matters for the auth endpoints. Login is reachable while a stale
 * token is still in storage, the server ignores it, and a 401 there means bad
 * credentials rather than a dead session. Without this flag the transport
 * would see a token on the request, treat the 401 as a revocation, and sign
 * the user out mid-login.
 */
export interface RequestOptions {
  /** Send no Authorization header, and do not treat a 401 as a revocation. */
  anonymous?: boolean;
  /**
   * Send the session, but with `no-referrer`, `no-store` and `credentials:
   * omit`. For authenticated calls made from a page whose own URL is a
   * credential, which is the RSVP page and currently only the RSVP page.
   */
  privacy?: boolean;
  /**
   * Override the 15s default for this call.
   *
   * For uploads. A 5 MB image on a slow connection legitimately needs longer,
   * and the path this replaces used a bare fetch with no timeout at all.
   */
  timeoutMs?: number;
}

/** The stored bearer token, or null. */
export async function getAuthToken(): Promise<string | null> {
  return getStoredToken();
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  // The app has no /auth URL route — auth is a state machine keyed off the
  // PERSISTED zustand store ('party-store'). If only the token is cleared,
  // the rehydrated store still says "logged in", every call 401s, and the
  // user is stuck in a loop. Clear both, then land on the root.
  try {
    clearAuth();
    window.localStorage.removeItem('party-store');
  } catch {
    // Storage unavailable — reload still forces re-auth because the token
    // is gone from memory.
  }
  const path = window.location.pathname || '';
  // The RSVP page is the one authenticated surface that is still useful signed
  // out, and its URL contains the invitation token. Navigating away from it
  // destroys the only copy of that token the invitee has, turning an expired
  // session into a lost invitation. Clear the dead session and leave the page
  // standing; JoinEventPage reads the 401 and renders its sign-in panel.
  if (path.startsWith('/join/')) return;
  if (path === '/' || path.includes('/auth') || path.includes('/login')) {
    window.location.reload();
    return;
  }
  window.location.href = '/';
}

/**
 * Bridge the web's synchronous localStorage to the transport's async contract.
 *
 * Async by necessity in the interface, because React Native's AsyncStorage is
 * promise-based and one code path is worth more than one saved microtask.
 * `clearSessionIfToken` is the compare-and-swap that stops a stale in-flight
 * 401 from destroying a session that has since been replaced.
 */
const webStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private mode or storage disabled. The transport reports the failure;
      // it must not crash the caller.
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // As above.
    }
  },
  async clearSessionIfToken(expectedToken: string): Promise<boolean> {
    if (getStoredToken() !== expectedToken) return false;
    redirectToLogin();
    return true;
  },
};

/**
 * The base URL is read lazily on every request by `getApiBaseUrl`, so a
 * transport built once at module load would pin the value at import time.
 * It is cheap to construct, so it is rebuilt when the base changes.
 */
let cachedBase: string | null = null;
let cachedTransport: ReturnType<typeof createTransport> | null = null;

function transport() {
  const base = getApiBaseUrl();
  if (cachedTransport === null || cachedBase !== base) {
    cachedBase = base;
    cachedTransport = createTransport({
      // '' means same-origin, which is the deployed configuration: nginx
      // serves the bundle and proxies /api.
      baseUrl: base,
      storage: webStorage,
      telemetry: recordApiCall,
      onUnauthorized: redirectToLogin,
    });
  }
  return cachedTransport;
}

/** Widen the shared envelope to this module's, which carries `code`. */
function adapt<T>(result: CoreApiResponse<T>): ApiResponse<T> {
  if (!result.error) return { data: result.data, error: null };
  return {
    data: null,
    error: {
      message: result.error.message,
      status: result.error.status,
      code: result.error.code,
    },
  };
}

export async function apiGet<T = unknown>(
  path: string,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  return adapt(
    await transport().request<T>(path, { method: 'GET', anonymous: options?.anonymous, privacy: options?.privacy, timeoutMs: options?.timeoutMs }),
  );
}

export async function apiPost<T = unknown>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  return adapt(
    await transport().request<T>(path, { method: 'POST', body, anonymous: options?.anonymous, privacy: options?.privacy, timeoutMs: options?.timeoutMs }),
  );
}

export async function apiPut<T = unknown>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  return adapt(
    await transport().request<T>(path, { method: 'PUT', body, anonymous: options?.anonymous, privacy: options?.privacy, timeoutMs: options?.timeoutMs }),
  );
}

export async function apiPatch<T = unknown>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  return adapt(
    await transport().request<T>(path, { method: 'PATCH', body, anonymous: options?.anonymous, privacy: options?.privacy, timeoutMs: options?.timeoutMs }),
  );
}

/**
 * DELETE, optionally with a body.
 *
 * The body parameter is new. Three existing routes require one
 * (`DELETE /api/mvp/events/:id`, `DELETE /api/mvp/guests/:id` and
 * `DELETE /api/partycrew/requests`), and the web could not call any of them.
 * Existing single-argument callers are unaffected.
 */
export async function apiDelete<T = unknown>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  return adapt(
    await transport().request<T>(path, { method: 'DELETE', body, anonymous: options?.anonymous, privacy: options?.privacy, timeoutMs: options?.timeoutMs }),
  );
}
