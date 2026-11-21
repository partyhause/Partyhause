/**
 * Retry keys for the command endpoints.
 *
 * Every write on `/api/mvp` requires an `Idempotency-Key` header, which the
 * server stores on `mvp_commands` under a unique `(actor_id, idempotency_key)`
 * and replays rather than re-applying (server/lib/mvp-command.ts:105).
 *
 * WHY THIS LIVES IN http/ AND NOT IN mvp.ts
 *   It was defined in ./mvp.ts, the iOS-MVP-only client, whose sole caller is a
 *   test. `createApiClient` now exposes the invitation resource too, so the
 *   shared client needs the same helper. Importing it from the MVP module would
 *   point the general entry point at the narrow one, which is the wrong
 *   direction. The definition moved here and ./mvp.ts re-exports it, so no
 *   existing import path changed.
 */

/**
 * Create a collision-resistant retry key without requiring a platform package.
 *
 * @param scope A short label for the operation, so a key is legible in
 *        `mvp_commands.idempotency_key` when someone is reading the log to work
 *        out what a client did.
 * @returns `scope:entropy`. Stable for the lifetime of one user intent: the
 *          caller must generate it once and reuse it across retries of that
 *          same intent, because a fresh key on retry is a second command and
 *          defeats the purpose.
 *
 * `crypto.randomUUID` is preferred. The fallback exists because it is absent on
 * older React Native runtimes and in some non-secure browser contexts, and a
 * client that throws there cannot send anything at all.
 */
export function createMvpIdempotencyKey(scope: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  const entropy = randomUuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `${scope}:${entropy}`;
}
