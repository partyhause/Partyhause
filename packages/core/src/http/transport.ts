/**
 * The request engine shared by web and mobile.
 *
 * Ported from src/lib/api-client.ts, which already had the behaviour worth
 * keeping (bounded timeout, idempotent-only retry, 401 handling, error
 * normalisation) but reached directly for localStorage, window.location and a
 * web-only telemetry module. Those are now injected via ./adapters.
 *
 * Contains no browser or React Native API. `fetch`, `AbortController` and
 * `URLSearchParams` are the only globals used, and all three exist in modern
 * browsers and in React Native's Hermes runtime.
 */

import type { ApiClientConfig, TokenStorage, Telemetry, UnauthorizedHandler } from './adapters';
import { STORAGE_KEYS } from './adapters';

/** Uniform result. Exactly one of `data` and `error` is non-null. */
export interface ApiResponse<T = unknown> {
  data: T | null;
  error: ApiError | null;
}

export interface ApiError {
  message: string;
  /** Absent when the request never reached the server. */
  status?: number;
  /**
   * Machine-readable error code, when the route sends one.
   *
   * Only `POST /api/auth/login` sets one today: `EMAIL_NOT_VERIFIED`, on a 403
   * that is deliberately distinct from the 401 for bad credentials. The
   * distinction matters because the two need opposite remedies, a resend
   * versus a reset, and the client cannot tell them apart from the message
   * text. It was being discarded here, so mobile had to infer intent from the
   * status code, which is fragile the moment a second 403 appears on that
   * route.
   */
  code?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Skip the Authorization header. Used by login and signup. */
  anonymous?: boolean;
  /**
   * Apply the leak-proofing fetch options without dropping the session.
   *
   * These used to be reachable only through `anonymous`, which was fine while
   * every RSVP call was anonymous. Submitting an RSVP now requires a session,
   * but the page making that call still has the invitation token in its URL,
   * so it still must not send a Referer or leave a cached copy. Separating the
   * two means an authenticated call can have the hardening without pretending
   * to have no session, instead of choosing between a leak and a 401.
   */
  privacy?: boolean;
  /**
   * Override the client's timeout for this call.
   *
   * Exists for file upload. A 5 MB image on a slow connection legitimately
   * exceeds the 15s default, and the alternative the upload path used before
   * this was a bare fetch with no timeout at all, which hangs until the
   * browser gives up. Bounded and explicit beats unbounded.
   */
  timeoutMs?: number;
}

/**
 * True for a body the platform must serialise itself.
 *
 * Duck-typed rather than `instanceof FormData`, because this package is
 * consumed by React Native as well as the browser and referencing a global
 * that may not exist would throw at module scope on the narrower platform.
 */
function isPlatformEncodedBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const tag = Object.prototype.toString.call(body);
  if (tag === '[object FormData]' || tag === '[object Blob]' || tag === '[object File]') return true;
  if (tag === '[object URLSearchParams]' || tag === '[object ArrayBuffer]') return true;
  // RN's FormData does not always carry the standard tag.
  return typeof (body as { append?: unknown }).append === 'function'
    && typeof (body as { getParts?: unknown }).getParts === 'function';
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Gateway failures are transient; retrying a GET is safe and usually works. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 600;
/**
 * At most two attempts, and only for GET. Retrying a POST could duplicate an
 * event or a guest, so mutations are never retried (Power of 10 rule 2: every
 * loop has a provable bound).
 */
const MAX_GET_ATTEMPTS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: RequestOptions['query'],
): string {
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${baseUrl.replace(/\/+$/, '')}${normalisedPath}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * Extract a human-usable message from a parsed error body.
 *
 * The API is not perfectly consistent: some routes return `{ error }`, others
 * `{ message }`, and a few return plain text. Falling back to the status code
 * guarantees a non-empty message in every case.
 */
function messageFromBody(parsed: unknown, status: number): string {
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.error === 'string' && obj.error) return obj.error;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
  }
  if (typeof parsed === 'string' && parsed.length > 0) return parsed;
  return `HTTP error! status: ${status}`;
}

/**
 * Extract a machine-readable `code` from a parsed error body.
 *
 * @returns the code, or undefined when the route did not send one.
 */
function codeFromBody(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const code = (parsed as Record<string, unknown>).code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** A bound request function plus the storage it authenticates from. */
export interface Transport {
  request<T = unknown>(path: string, options: RequestOptions): Promise<ApiResponse<T>>;
  storage: TokenStorage;
  baseUrl: string;
}

/**
 * Build a transport bound to one platform's adapters.
 *
 * SAME-ORIGIN IS A VALID BASE
 *   An empty `baseUrl` used to throw. That made this transport unusable from
 *   the web app, whose `apiUrl()` returns a bare path when `VITE_API_URL` is
 *   unset (src/lib/apiBase.ts:38-44), which is the normal configuration when
 *   nginx serves the bundle and proxies /api on the same origin. It was the
 *   single hard incompatibility between the two clients, and it is why the web
 *   kept its own.
 *
 *   Empty is now explicitly allowed and means "resolve against the current
 *   origin". A whitespace-only or malformed value is still refused, because
 *   those are typos rather than intent.
 *
 * @param config Base URL, storage, and optional telemetry / 401 handler.
 * @returns A transport whose `request` never throws; inspect `error`.
 * @throws Error if `baseUrl` is a non-empty value that is not an absolute URL,
 *         or if `timeoutMs` is not positive.
 */
export function createTransport(config: ApiClientConfig): Transport {
  const rawBaseUrl = config.baseUrl ?? '';
  const baseUrl = rawBaseUrl.trim();
  // Distinguish "no base, use the current origin" from "a base that is only
  // whitespace". The first is how the web app is deployed; the second is
  // VITE_API_URL=" " and would otherwise resolve every path against the wrong
  // origin in a deployment that meant to call a remote API.
  if (rawBaseUrl !== '' && baseUrl === '') {
    throw new Error(
      "createTransport: baseUrl must be an absolute http(s) URL or '' for same-origin, received whitespace",
    );
  }
  if (baseUrl !== '' && !/^https?:\/\//i.test(baseUrl)) {
    throw new Error(
      `createTransport: baseUrl must be an absolute http(s) URL or '' for same-origin, received ${JSON.stringify(config.baseUrl)}`,
    );
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`createTransport: timeoutMs must be positive, received ${timeoutMs}`);
  }
  const storage: TokenStorage = config.storage;
  const telemetry: Telemetry | undefined = config.telemetry;
  const onUnauthorized: UnauthorizedHandler | undefined = config.onUnauthorized;

  async function fetchWithTimeout(
    url: string,
    init: Record<string, unknown>,
    budgetMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal } as RequestInit);
    } finally {
      clearTimeout(timer);
    }
  }

  function report(record: Parameters<Telemetry>[0]): void {
    if (!telemetry) return;
    try {
      telemetry(record);
    } catch {
      // Observability must never change an outcome.
    }
  }

  async function request<T = unknown>(
    path: string,
    options: RequestOptions,
  ): Promise<ApiResponse<T>> {
    const { method, body, headers, query, anonymous, privacy } = options;
    // A non-positive override would disable the bound entirely, which is the
    // failure this replaces. Fall back to the client default rather than honour it.
    const budgetMs =
      Number.isFinite(options.timeoutMs) && (options.timeoutMs as number) > 0
        ? (options.timeoutMs as number)
        : timeoutMs;
    const platformEncoded = isPlatformEncodedBody(body);
    const startedAt = now();
    let attempts = 0;

    const finish = (
      status: number | null,
      ok: boolean,
      errorMessage: string | null,
    ): void => {
      report({
        timestamp: new Date().toISOString(),
        method,
        path,
        status,
        ok,
        durationMs: Math.round(now() - startedAt),
        attempts,
        errorMessage,
      });
    };

    const finalHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...(headers || {}),
    };
    let requestToken: string | null = null;
    // Never set Content-Type for a FormData body: the platform has to write
    // it, because only it knows the multipart boundary. Setting it by hand
    // produces a body the server cannot parse.
    if (body !== undefined && body !== null && !platformEncoded) {
      finalHeaders['Content-Type'] = 'application/json';
    }
    if (!anonymous) {
      try {
        requestToken = await storage.getItem(STORAGE_KEYS.token);
        if (requestToken) finalHeaders['Authorization'] = `Bearer ${requestToken}`;
      } catch {
        const message = 'Secure credential storage is unavailable';
        finish(null, false, message);
        return { data: null, error: { message, code: 'STORAGE_UNAVAILABLE' } };
      }
    }

    const url = buildUrl(baseUrl, path, query);
    const init = {
      method,
      headers: finalHeaders,
      body:
        body === undefined || body === null
          ? undefined
          : platformEncoded
            ? (body as BodyInit)
            : JSON.stringify(body),
      // An anonymous request carries no session and must not leak one.
      //
      // These three are not incidental. The RSVP flow puts a bearer token in
      // the page URL, because the guest replying to an invitation has no
      // account and the token IS the credential. Without `no-referrer` that
      // token travels in a Referer header to anything the page links to;
      // without `no-store` it sits in a shared cache; without `omit` any
      // cookie on the origin rides along on a request that by definition
      // should not be authenticated.
      //
      // They were previously set only by src/lib/rsvp-client.ts, a separate
      // hand-rolled client that existed largely to have them. Attaching them
      // to `anonymous` means every anonymous call gets the correct posture
      // rather than the one caller that remembered.
      ...(anonymous || privacy
        ? {
            credentials: 'omit' as const,
            cache: 'no-store' as const,
            referrerPolicy: 'no-referrer' as const,
          }
        : {}),
    };

    const maxAttempts = method === 'GET' ? MAX_GET_ATTEMPTS : 1;
    let response: Response | null = null;
    let networkError: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      try {
        response = await fetchWithTimeout(url, init, budgetMs);
      } catch (err) {
        const aborted =
          typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
        networkError = aborted
          ? `Request timed out after ${Math.round(budgetMs / 1000)}s`
          : err instanceof Error
            ? err.message
            : 'Network request failed';
        response = null;
        if (attempt < maxAttempts) await sleep(RETRY_DELAY_MS);
        continue;
      }
      if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }

    if (!response) {
      const message = networkError || 'Network request failed';
      finish(null, false, message);
      return { data: null, error: { message } };
    }

    let parsed: unknown = null;
    let bodyReadError: string | null = null;
    try {
      const text = await response.text();
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
    } catch (error) {
      bodyReadError = error instanceof Error ? error.message : 'Response body could not be read';
    }

    if (response.status === 401) {
      const message = bodyReadError || messageFromBody(parsed, 401);
      finish(401, false, message);
      if (requestToken) {
        try {
          if (storage.clearSessionIfToken) {
            await storage.clearSessionIfToken(requestToken);
          } else if (await storage.getItem(STORAGE_KEYS.token) === requestToken) {
            await storage.removeItem(STORAGE_KEYS.token);
            await storage.removeItem(STORAGE_KEYS.user);
          }
        } catch {
          // The platform observer below handles cleanup failure explicitly.
        }
        if (onUnauthorized) {
          try {
            await onUnauthorized(requestToken ?? undefined);
          } catch {
            // A failing navigation response must not mask the API result.
          }
        }
      }
      return {
        data: null,
        error: { message, status: 401, code: codeFromBody(parsed) },
      };
    }

    if (bodyReadError) {
      finish(response.status, false, bodyReadError);
      return { data: null, error: { message: bodyReadError, status: response.status } };
    }

    if (!response.ok) {
      const message = messageFromBody(parsed, response.status);
      const code = codeFromBody(parsed);
      finish(response.status, false, message);
      return {
        data: null,
        // `code` is omitted entirely when the route did not send one, rather
        // than present and undefined. A caller doing `'code' in error` should
        // get a truthful answer, and `toStrictEqual` in the tests distinguishes
        // the two.
        error: code ? { message, status: response.status, code } : { message, status: response.status },
      };
    }

    finish(response.status, true, null);
    return { data: parsed as T, error: null };
  }

  return { request, storage, baseUrl };
}
