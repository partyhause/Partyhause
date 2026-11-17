# AGENTS.md

Engineering source of truth for PartyHause. Written for AI agents and humans working in this
repository.

Every claim below was verified by reading the code on 2026-09-04, not by trusting prior
documentation. Where the codebase is ambiguous or contradicts itself, that is stated rather than
smoothed over. If this file disagrees with any other document in the repository, this file wins.
See [Documentation map](#documentation-map) for why that rule exists.

`README.md` is the product front door and is written for a non-engineering audience. It is not an
engineering reference.

---

## Stack

| Layer | Technology | Location |
|---|---|---|
| Web | React 18.3.1, TypeScript 5.9.3, Vite 7.1.9, `vite-plugin-pwa` | `src/` |
| UI | Tailwind CSS 3, shadcn/ui on Radix, framer-motion | `src/components/` |
| Web state | Zustand 4 (one persisted store) plus TanStack Query v4 | `src/store/usePartyStore.ts` |
| API | Django 4.2.30, Gunicorn on port 8001 | `django/` |
| ORM | Prisma 7.10.0 with the `@prisma/adapter-pg` driver adapter | `prisma/`, `server/lib/prisma.ts` |
| Database | PostgreSQL 15, Azure Flexible Server | `prisma/schema.prisma` |
| Auth | Self-hosted JWT, HS256, bcryptjs cost 12 | `server/routes/auth.ts`, `server/middleware/auth.ts` |
| Realtime | Azure Web PubSub over native WebSocket | `server/lib/pubsub.ts`, `src/hooks/use-realtime.ts` |
| Storage | Azure Blob Storage, server-side upload via multer | `server/routes/storage.ts` |
| Email | Azure Communication Services primary, Resend fallback | `server/lib/email.ts` |
| Mobile | Expo SDK 54, React Native 0.81, expo-router 6 | `apps/mobile/` |
| Shared client | TypeScript API client, shipped as raw `.ts` | `packages/core/` |
| Infra | Bicep, subscription scope, to Azure Container Apps | `infra/` |

### Local development

#### Option 1: All-in-one dev script (recommended)
```bash
# 1. Install. Peer-dependency conflicts are expected and the flag is required.
npm ci --legacy-peer-deps

# 2. Generate the Prisma client. Both CI workflows do this before anything else.
npx prisma generate

# 3. Apply the schema to a local Postgres.
DATABASE_URL="postgresql://localhost:5432/partyhause" npx prisma migrate deploy
DATABASE_URL="postgresql://localhost:5432/partyhause" npx tsx prisma/seed.ts

# 4. Start everything (API, web, and Mailpit dev email catcher) in one terminal:
npm run dev:all
#   - API: http://localhost:8001 (Django, proxied by Vite)
#   - Web: http://localhost:5173 
#   - Mailpit UI: http://localhost:8025
#   - Logs: /tmp/ph-*.log
```

#### Option 2: Manual separate terminals
```bash
# 1-3. (Same as above)

# 4. Start the Django API on 8001:
#    cd django && python manage.py runserver 8001
# 5. In another terminal, start the web app on 5173. Vite proxies /api to Django on 8001:
npm run dev
# 7. Verify.
curl localhost:8001/api/health
**Backend rule (load-bearing):** The frontend's only backend is Django on port 8001. Vite proxies `/api` → `http://localhost:8001` (`vite.config.ts:83-85`). Keep `VITE_API_URL` empty so requests are same-origin relative paths that Vite proxies. If `VITE_API_URL` is set to an absolute origin, `apiUrl()` bypasses the proxy and hits that origin directly — this is what caused all API calls to hit dead port 8000. The Express server in `server/` (`index.ts`, port 3001) is **not** used by the frontend and must not be started for development — it is a retired duplicate. Do not add routes to `server/`; add them to `django/` and register them in `django/partyhause/urls.py`.

### Two corrections to long-standing claims

**Supabase is gone, including the name.** The SDK was never installed: it is absent from every
`package.json`, from both lockfiles, and from `node_modules`. The last references were removed on
2026-09-08. `src/lib/supabase.ts` is now `src/lib/auth-storage.ts` and exports only the five
localStorage helpers; the object it also exported, which mimicked a database client so that
pre-migration call sites kept compiling, is deleted rather than renamed. That stub was a liability:
`from().select().order()` resolved to `{ data: [] }`, an empty result indistinguishable from a real
empty table, so a caller that reached for the database got silence instead of an error. Seven
`auth.getSession()` call sites now read `getStoredToken()` directly.

Also removed in that change: the `supabase/` directory (26 migrations that could never run on Azure,
since they declare `supabase_vault` and `auth.users`), the root `schema.sql`, `src/lib/env-server.ts`,
a false subprocessor list in `public/privacy.html`, an unreachable branch in `ErrorBoundary` that
shipped an outbound vendor link in every production bundle, and thirteen scripts importing an
uninstalled package. A case-insensitive search for the vendor name now returns nothing outside
`docs/`, where the historical set is deliberately unedited.

**The two localStorage keys are a compatibility surface.** `partyhause_auth_token` and
`partyhause_auth_user` are written by `src/lib/auth-storage.ts` and, independently, by
`packages/core/src/http/adapters.ts:73-74` for mobile. They survived the rename on purpose. Changing
either name signs out every existing user, and a session is the conjunction of both:
`src/hooks/use-auth.ts` hydrates only when the token and the cached user are both present, so any
path that writes one without the other produces a valid session the app renders as signed out.

**Realtime is a native `WebSocket`, not socket.io.** `src/hooks/use-realtime.ts:163` constructs
`new WebSocket(url, 'json.webpubsub.azure.v1')`. `socket.io-client` is not a dependency.

### Version hazards

- **Node is specified three ways.** `package.json:7` says `>=18.0.0`, `.nvmrc` and `.node-version`
  pin `18.18.0`, and both workflows plus both Dockerfiles use Node 20. Node 20 is what actually
  builds and runs.
- **React majors diverge across the workspace.** Web is React 18.3.1, mobile is React 19.1.0.
- **The mobile lockfile does not satisfy its manifest.** `expo` is declared `~54.0.35` and locked at
  `54.0.13`; `react-native` declared `^0.81.5`, locked `0.81.4`; `expo-router` declared `~6.0.24`,
  locked `6.0.12`.
- **`npm run test:ui` cannot work.** `@vitest/ui` is not in `devDependencies`.

---

## Repository layout

npm workspaces are `packages/*` only (`package.json:10-12`). `apps/mobile` is **not** a workspace
member: it installs standalone against its own `package-lock.json`, with `legacy-peer-deps=true`
and `engine-strict=true` set in `apps/mobile/.npmrc`. The root `npm ci` does not install mobile
dependencies, and a mobile install does not see the root lockfile.

| Path | Contents |
|---|---|
| `src/` | Vite React PWA. `App.tsx`, `pages/` (11), `features/` (partyboard, partycrew, polls, timeline, notifications), `components/`, `lib/`, `store/`, `test/` |
| `server/` | Express API. `index.ts` entrypoint, `routes/` (20 files), `lib/` (9), `middleware/auth.ts` |
| `packages/core/` | Shared API client and zustand store. Ships raw TypeScript; `main` points at `src/index.ts` |
| `apps/mobile/` | Expo Router app. Own lockfile, `app.config.ts`, `eas.json`, `ios/` |
| `prisma/` | `schema.prisma` (1231 lines, 39 models) and `seed.ts` |
| `infra/` | Bicep. `main.bicep` (subscription scope), `resources.bicep`, `modules/` (5) |
| `scripts/` | 22 operational scripts. Six are wired to npm scripts; the rest are run by hand, including the three `e2e-*.mjs` database suites. `enroll-production-migrations.cjs` and `production-migration-preflight.cjs` are the production path for adopting the migration history and are described under Data model |
| `docs/` | 88 markdown files, all current, historical or non-technical. 97 stale ones were deleted on 2026-09-04. Index at [`docs/README.md`](./docs/README.md) |

**`packages/core` is consumed by mobile only.** `rg "@partyhause/core" src/` returns nothing. The
web app runs a separate client at `src/lib/api-client.ts`. This is a real cost: the same contract
bug has to be fixed in both places, and has been, more than once. Treat any change to an API
contract as a two-site change until the clients are unified.

---

## Local development

```bash
# 1. Install. Peer-dependency conflicts are expected and the flag is required.
npm ci --legacy-peer-deps

# 2. Generate the Prisma client. Both CI workflows do this before anything else.
npx prisma generate

# 3. Apply the schema to a local Postgres.
DATABASE_URL="postgresql://localhost:5432/partyhause" npx prisma migrate deploy
DATABASE_URL="postgresql://localhost:5432/partyhause" npx tsx prisma/seed.ts

# 4. Start the API on 3001. dev-api.ts sets AUTH_BYPASS=true for local work.
npm run dev:api

# 5. In another terminal, start the web app on 5173. It proxies /api to 3001.
npm run dev

# 6. Verify.
curl localhost:3001/api/health
```

`AUTH_BYPASS` only works when `NODE_ENV !== 'production'`, and both conditions are required
(`server/middleware/auth.ts:23-25`). It upserts a real user row, `dev@partyhause.local`, so local
data is attributable. A valid real token always beats the bypass.

### Commands

| Command | What it does | Used by |
|---|---|---|
| `npm run dev` | Vite dev server, port 5173 | |
| `npm run dev:api` | API with watch and `AUTH_BYPASS=true` | |
| `npm run build:web` | `vite build` | Dockerfile |
| `npm run typecheck` | Five `tsc` projects: app, node, server, core, mobile | via `build:check` |
| `npm run build:check` | `typecheck` then `audit:contracts` then `vite build` | **CI and deploy** |
| `npm run lint` | `eslint .` | **CI and deploy** |
| `npm run test:run` | `vitest run` | **CI and deploy** |
| `npm run audit:contracts` | Compares client call shapes to server route expectations | via `build:check` |
| `npm run audit:endpoints` | Endpoint inventory | not wired to CI |
| `npm run server` | API without watch or bypass | |

`build:check` is the real gate. Note that `vite build` does not typecheck, so a type error will
still produce a working bundle if you bypass `build:check`.

---

## API surface

Base URL in production is the API Container App FQDN. All routes are under `/api`.

`server/index.ts` mounts 26 routers behind `apiLimiter`, plus inline endpoints registered **before**
the limiter: `GET /api/health`, `POST /api/send-email`, and the favicon and SPA fallback when
`dist/` exists. `/api/send-email` is outside `apiLimiter` deliberately, so a mail send cannot be
starved by ordinary API traffic; it carries its own `emailLimiter`, 20 per 5 minutes keyed on the
authenticated user.

104 routes across 23 files.

**There are two generations of API here and that is deliberate.** The `/api/mvp` surface added on
2026-09-09 is the one the iOS app is being built against; the older flat routers below it are what
the web app uses. The new one does not replace them and no existing route changed behaviour, so
nothing that worked before works differently now. Do not add to both: a new capability belongs on
`/api/mvp`, and the older routers should shrink as the web client moves across.

| MVP router | Routes |
|---|---|
| `/api/mvp` | `GET /events`, `POST /events`, `GET /events/:id`, `PATCH /events/:id`, `POST /events/:id/publish`, `POST /events/:id/cancel`, `DELETE /events/:id`, `GET /events/:eventId/guests`, `POST /events/:eventId/guests`, `GET /events/:eventId/invitations`, `POST /events/:eventId/invitations/send`, `GET /guests/:id`, `PATCH /guests/:id`, `DELETE /guests/:id`, `POST /guests/:id/check-in`, `POST /guests/:id/check-in/correction` |
| `/api/mvp/account` | `GET /`, `POST /deletion-intent`, `POST /deletion`, `GET /deletion/:receipt` |
| `/api/rsvp` | `POST /resolve`, `PUT /` |

Writes on `/api/mvp` require an `Idempotency-Key` header and carry an expected `revision`, so a
retried request cannot double-apply and two editors cannot silently overwrite each other.
`/api/mvp/account` exists because App Store review requires in-app account deletion of any app that
creates accounts.

**`/api/rsvp` is split: the read is anonymous and the write binds opportunistically.** This changed on
2026-09-15 and the two halves are deliberate. `POST /resolve` takes no session, because someone
deciding whether to create an account has to be able to see what they are being invited to first; a
sign-in wall there makes the invitation unreadable to exactly the people it is addressed to. `PUT /`
records the answer, and when the caller is signed in with the invited address it also binds the seat
to that account, so the guest list records who was invited rather than who holds a link. Which
regime an invitation is under is per-invitation: `guest_invitations.requires_account` is false by
default while the app is iPhone-only, so anonymous answers are the default contract and an
account-required invitation is one the host opted into.

Three consequences that are easy to get wrong:

- The route uses `attachOptionalActor`, **not** `requireAuth`. Anonymous answering is the default
  contract, not a legacy one, and the service decides which regime applies per invitation from
  `guest_invitations.requires_account`. Swapping in `requireAuth` breaks every link currently
  sitting in an inbox.
- `attachOptionalActor` exists because `optionalAuth` substitutes the dev bypass user for a token
  that is *present but unusable* (expired, revoked, unverified). A guest whose session lapsed
  presents exactly that, so on RSVP it would bind the seat to `dev@partyhause.local` instead of
  answering `RSVP_ACCOUNT_REQUIRED`. RSVP is the one route that must not accept the bypass.
- `resolve` returns `invitedEmailHint`, a masked address such as `a****@example.com`, never the
  full one. The hint exists so a guest with several addresses can tell which was invited; the
  masking exists because a signup bearing a valid token is auto-verified on that address.

`POST /api/invites/join` moved to `requireAuth` in the same change. It writes `rsvp_status:
'accepted'`, so leaving it on `optionalAuth` would have kept an anonymous RSVP open under a second
URL. It now claims an existing guest row matching the caller's address rather than creating a second
one.

| Router | Routes |
|---|---|
| `/api/auth` | `POST /signup`, `POST /verify-email`, `POST /resend-verification`, `POST /login`, `GET /me`, `POST /forgot-password`, `POST /reset-password`, `POST /logout` |
| `/api/events` | `GET /:id?`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/guests` | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/timeline` | `GET /:eventId`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/polls` | `GET /`, `POST /`, `GET /:id`, `POST /:id/vote`, `POST /:id/close` |
| `/api/partyboard` | `GET /stickies`, `POST /stickies`, `PATCH /stickies/:id/position`, `PATCH /stickies/:id/vote`, `POST /stickies/:id/convert-to-task`, `GET /tasks`, `DELETE /stickies/:id` |
| `/api/invite-templates` | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/event-templates` | `GET /`, `GET /:id`, `POST /:id/create-event` |
| `/api/email-webhook` | `POST /` (anonymous, svix HMAC verified) |
| `/api/email-logs` | `POST /`, `PUT /:id`, `GET /`, `GET /:id`, `GET /analytics/event` |
| `/api/connections` | `GET /`, `POST /`, `DELETE /:id` |
| `/api/partycrew` | `GET /members`, `GET /crewing-with`, `GET /toggle`, `POST /toggle`, `GET /requests`, `POST /requests`, `DELETE /requests` |
| `/api/users` | `GET /me/profile`, `PUT /me/profile`, `GET /suggested`, `GET /:id` |
| `/api/feed` | `GET /crew`, `POST /seen` |
| `/api/invites` | `POST /generate`, `POST /join`, `POST /convert-guest` |
| `/api/cost-split` | `GET /:eventId`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `/api/ai` | `POST /chat`, `POST /extract-event-details` |
| `/api/storage` | `POST /upload`, `DELETE /:blobName`, `GET /url/:blobName` |
| `/api/realtime` | `GET /negotiate` |
| `/api/notifications` | `GET /`, `GET /unread-count`, `POST /mark-read` |

### Known API defects

- **The global error handler returns `err?.message` to the client** in 500 bodies
  (`server/index.ts:393`).
- **Empty `CORS_ALLOWED_ORIGINS` allows all origins** (`server/index.ts:219`).

The entry reading *"`optionalAuth` does not enforce `email_verified`, unlike `requireAuth`"* was
removed on 2026-09-15 because it is not true, and the version of it that is true is a different
defect. `optionalAuth` does not admit an unverified user: `applyVerifiedToken` returns `'unverified'`
without setting `req.user`, and the caller then clears it. What it does do is substitute the dev
bypass user for a token that is present and unusable, which is the reverse of what the name implies
and is why RSVP uses `attachOptionalActor` instead. Both halves are pinned by
`src/test/auth-optional-actor.test.ts`, so the next person does not have to re-derive it from the
control flow.

Two long-standing entries were removed from this list on 2026-09-07 because they are fixed, not
because they were reclassified.

`POST /api/send-email` is no longer an open relay. It requires `requireAuth`, requires a top-level
`event_id`, requires the caller to hold invite permission on that event, and refuses any recipient
who is not already on that event's guest list. `emailLimiter` bounds it at 20 sends per 5 minutes
per user. That closes `GAP-INV-04`.

`GET /api/email-logs/analytics/event` is reachable. It was registered after `GET /:id`, so Express
bound `id="analytics"` and answered 404 for the life of the endpoint. It now sits above `/:id`
(`email-logs.ts:149`), and both routes are verified working against a live database. **Keep that
ordering.** Any new literal path under this router must be registered before `/:id`.

---

## Auth

Self-hosted. No Supabase, no working Entra path.

**Issuance.** `jsonwebtoken` HS256. Claims are `{ sub, email, name, email_verified }`
(`routes/auth.ts:71-75`). Lifetime from `JWT_EXPIRES_IN`, default `7d`. Secret from
`server/lib/jwt-secret.ts`, which in production throws if the secret is empty, equals the committed
dev fallback, or is shorter than 32 characters. `assertJwtSecretConfigured()` runs before
`app.listen` and exits 1 on failure.

**Verification.** `jwt.verify` in `middleware/auth.ts:104`. No explicit `algorithms` allowlist is
passed; jsonwebtoken 9 rejects `alg: none` by default, but the allowlist should be explicit.

**Passwords.** bcryptjs cost 12 for passwords, cost 10 for verification and reset tokens. Minimum
length 8, no complexity rule.

**Email verification is enforced at three points**, and all three are required:

1. Signup returns no token at all (`routes/auth.ts:234-241`).
2. Login rejects unconfirmed accounts with **403 `EMAIL_NOT_VERIFIED`**, deliberately distinct from
   the 401 for bad credentials, so the client can offer a resend instead of a password reset.
3. `requireAuth` rejects any token whose `email_verified` claim is not `true`, which catches tokens
   minted before the gate existed. That mattered more when tokens could not be revoked; gating
   login alone would have left a week-long hole.

**Signup has exactly one exception to point 1, and it is narrow.** `POST /api/auth/signup` accepts an
optional `inviteToken`. When it resolves to an unexpired, unrevoked `guest_invitations` row whose
guest's `normalized_email` equals the address being registered, the account is created with
`email_verified: true` and a session is returned. The rule is satisfied rather than waived: the token
was mailed to that address, which is the same evidence a confirmation link supplies. Without it a
guest arrives from their inbox, registers, and is sent straight back to the same inbox before they
can answer, which is two trips on the one flow where a host is waiting for a number.

The cost is real and bounded rather than dismissed: whoever holds a link can create an account at
the invited address. The address must match exactly, an address that already has an account is
refused before the token is consulted, the link dies at `expires_at` or on revoke, and nginx and the
RSVP router both send `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on `/join/`.
`src/test/invited-signup-postgres.integration.test.ts` covers every branch that answers no; run it
with `DATABASE_URL` set. **A malformed or unmatched `inviteToken` must never fail the signup**, only
decline to verify it, or a bad link becomes a registration block.

**Tokens are revocable.** Every JWT carries a `token_version` claim and `requireAuth` rejects any
token whose epoch is behind the user's current one (`middleware/auth.ts:119`). Logout and password
reset both increment it, so signing out ends the session rather than merely advising the client to
forget it, and a reset ends every other session while keeping the one that performed it. A token
predating the claim has no epoch to compare and is refused as revoked.

`POST /api/auth/resend-verification` is **anonymous by design**. A user who cannot sign in has no
session, so putting it behind `requireAuth` made it the one endpoint a locked-out user needed and
could not reach. It answers identically whether or not the address exists.

**Rate limits.** `apiLimiter` 300 per 60s on `/api/*`. `credentialLimiter` 20 per 15 minutes on
every auth route except `/me` and `/logout`. `aiLimiter` 30 per 5 minutes, keyed on user id when
present.

**Entra External ID is bundled but inert, and would break auth if switched on.**
`isMsalConfigured` is `false` unless three `VITE_ENTRA_*` build args are set. Two things are
missing: `msalGetToken()` has zero call sites while `src/lib/api-client.ts` reads its bearer token
from localStorage, which MSAL never writes; and the API has no JWKS, issuer or audience validation
anywhere, so it cannot verify an Entra RS256 token. **Do not set `ENTRA_TENANT_ID` or
`ENTRA_SPA_CLIENT_ID` in the deploy workflow** until both are built.

---

## Data model

39 Prisma models and 2 enums in `prisma/schema.prisma`. Core entities: `User`, `UserProfile`,
`Event`, `EventCoHost`, `Guest`, `Ticket`, `TimelineBlock`, `Poll`, `PollOption`, `PollVote`,
`PartyBoardSticky`, `PartyBoardStickyVote`, `PartyBoardTask`, `Connection`, `ConnectionRequest`,
`PartycrewPost`, `Notification`, `EmailLog`, `EmailEvent`, `Template`, `InviteTemplate`,
`EventInviteToken`, `CostSplitRequest`, `Media`, `Vendor`, `VendorTask`.

`Vendor` and `VendorTask` exist in the schema but **have no API routes**. The vendor marketplace is
not built, and as of 2026-09-07 the UI says so rather than showing a dashboard of zeros. See
`src/pages/VendorDashboard.tsx` for why that was the choice.

The three `PartyBoard*` models back `/api/partyboard`. Votes are a table rather than a counter
column because the canvas renders `user_has_voted` per viewer, which a counter cannot answer, and
the unique `(sticky_id, user_id)` is what makes a repeated click a toggle instead of a second vote.

The datasource declares no `url` (Prisma 7 requirement); it is supplied by `prisma.config.ts` from
`DATABASE_URL`. `server/lib/prisma.ts` falls back to assembling a connection string from
`POSTGRES_*` parts with `sslmode=require` if `DATABASE_URL` fails to parse.

**There is a migration history now**, eight migrations in `prisma/migrations/`, started 2026-09-09.
Before that the schema was applied with `prisma db push` and nothing recorded how the deployed
shape had been reached.

| Migration | What it is |
|---|---|
| `20260905000000_baseline` | The schema as deployed. Written to be enrolled against an existing database, not only replayed onto an empty one |
| `20260905000100_database_functions` | The ten trigger and RPC functions that used to live in `server/sql/azure-pg-functions.sql`. Idempotent, and `test:migrations` runs it twice to prove it |
| `20260905000200_core_integrity_constraints` | The CHECK constraints the schema could only document in comments. This is where `events.status` gains `'cancelled'` |
| `20260906000000_ios_mvp_domain` | The MVP delta. 5 tables, 48 ALTERs, 4 backfills and 2 triggers, written to run against a populated production database |
| `20260909000000_partyboard_vote_tables` | Reconciles PartyBoard to the vote-row design. Copies `voter_ids` into rows **before** dropping the column |
| `20260913000000_username_identity` | Handles and the onboarding picker |
| `20260913120000_billing_and_onboarding` | Subscription and onboarding state |
| `20260915000000_rsvp_requires_account` | Adds `guest_invitations.requires_account` as a per-invitation switch, `DEFAULT false` with **no flip**: an account-required invitation is one an Android guest can never answer while the app is iPhone-only. Existing invitations are grandfathered to anonymous in one statement; flipping the default is one ALTER once an Android build exists. Also makes `guests(event_id, user_id)` unique |

That last one is worth reading before changing it. The backfill is the column default, deliberately
not a `created_at < now()` predicate: a predicate would classify rows by *when the migration ran*, so
replaying it against a restored dump would not reproduce the same database. The unique index relies
on PostgreSQL treating NULLs as distinct, which is what lets an event hold many unbound guests while
allowing at most one seat per account.

**Use `prisma migrate deploy`, not `prisma db push`.** A push against a database that has
migrations applied reshapes tables without recording anything, and the next `migrate diff` reports
drift with no explanation for it.

```bash
npm run test:migrations   # replay, idempotency, invariants, and a zero-drift assertion
```

That script is the gate. It finishes on
`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`, so the
history and `schema.prisma` cannot silently disagree.

**Production has a migration history as of 2026-09-27.** The database was found empty that day -
the stack recreation with the `k2xoe7s452aja` suffix had never migrated it, so every DB-touching
route answered 500 and login was impossible. All nine migrations were applied with
`prisma migrate deploy` and a `migrate diff` against `schema.prisma` reports zero drift. The
enrollment scripts below describe the older path, kept for the case where a restored dump or a
previously-populated database needs adopting into the history:

```bash
node scripts/production-migration-preflight.cjs   # data preconditions, read only
node scripts/enroll-production-migrations.cjs     # writes _prisma_migrations
```

The preflight matters because `20260906000000_ios_mvp_domain` adds a unique index on
`(event_id, normalized_email)` for guests. A production database holding two guests with the same
address on one event, or a guest with a blank one, will fail mid-migration with the table already
half-altered. Checking first is cheaper than recovering.

Enrollment records the baseline as applied without running it, then runs the migrations that came
after. Each entry carries a SHA-256 of its file and the script refuses to proceed on a mismatch, so
an edited migration cannot be enrolled unreviewed. **Editing any `migration.sql` therefore means
updating its checksum in that script**, and adding a migration means adding an entry; a load-time
guard compares the plan against `prisma/migrations/` and throws if they diverge.

```bash
npx prisma generate
DATABASE_URL="postgresql://..." npx prisma migrate deploy
DATABASE_URL="postgresql://..." npx tsx prisma/seed.ts
DATABASE_URL="postgresql://..." npx prisma studio
```

---

## Realtime, storage, email

**Realtime.** `GET /api/realtime/negotiate` (requires auth) returns a Web PubSub client URL with a
60 minute token. The browser opens a native `WebSocket` with the `json.webpubsub.azure.v1`
subprotocol. The server broadcasts `{ event, data }` envelopes via `sendToAll`. Hub name is
`WEBPUBSUB_HUB` or `partyhause`, and negotiate and broadcast must agree or clients listen to a hub
nothing publishes to. Negotiate returns 503 when `WEBPUBSUB_CONNECTION_STRING` is unset; the client
falls back to polling.

**Storage.** Uploads go through the API, not direct to blob. multer memory storage, 5 MB cap,
MIME allowlist of jpeg, png, webp, gif. Container `event-invites` has public blob read; `uploads`
does not.

**Email.** `server/lib/email.ts` prefers Azure Communication Services and falls back to Resend.
Delivery events arrive at `POST /api/email-webhook`, verified by svix HMAC-SHA256 over
`${svix-id}.${svix-timestamp}.${rawBody}` with a 300 second replay window, and are recorded in
`email_logs` and `email_events`.

---

## Environment variables

**The `VITE_*` and `EXPO_PUBLIC_*` split matters.** Both are inlined into the bundle at build time.
Setting them as runtime environment variables on a container does nothing, because the web
container is nginx serving static files and reads no environment at all.

### Build time, web (passed as `--build-arg` to `az acr build`)

`VITE_API_URL`, `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_SPA_CLIENT_ID`, `VITE_ENTRA_POLICY`.

`VITE_APP_NAME` and `VITE_APP_URL` are passed as build args but **are not read by anything in
`src/`**. `VITE_APP_URL` is read server-side only, where it is a runtime variable on the API
container and forms the base of emailed links.

### Runtime, API container

`PORT`, `NODE_ENV`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`, `POSTGRES_*`, `JWT_SECRET`,
`JWT_EXPIRES_IN`, `INVITATION_TOKEN_SECRET`, `VITE_APP_URL`, `ACS_CONNECTION_STRING`,
`ACS_SENDER_ADDRESS`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`,
`WEBPUBSUB_CONNECTION_STRING`, `WEBPUBSUB_HUB`, `AZURE_STORAGE_*`, `AZURE_OPENAI_*`,
`OPENAI_API_KEY`, `AUTH_BYPASS`, `AUTH_BYPASS_USER_ID`.

**`INVITATION_TOKEN_SECRET` is required and the API refuses to start without it.** It signs RSVP
links, which are bearer credentials in a URL, and `server/lib/invitation-token.ts` rejects a value
that is empty, shorter than the production minimum, or equal to `JWT_SECRET`. Sharing one secret
would mean a leaked invitation link and a session token were forgeable from the same key. It is
provisioned by Bicep (`infra/main.bicep`, `infra/resources.bicep`) like the others; a deploy that
forgets it fails at boot rather than at the first RSVP.

Secrets are provisioned by Bicep into the Container App `secrets` array and referenced with
`secretref:`. Since 2026-09-27 the Bicep secrets are Key Vault references resolved at run time
through the app's system-assigned identity (see the Infra hazards note). The deploy workflow
deliberately passes no environment variables, leaving Bicep as the single source of truth.

---

## Infrastructure

`infra/main.bicep` is **subscription scoped** and creates the resource group itself, so it needs
`az deployment sub create`, not `--resource-group`.

```bash
az deployment sub create \
  --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --parameters postgresAdminPassword="<pw>" \
  --parameters RESEND_API_KEY="<key>" \
  --parameters entraApiClientSecret="<secret>" \
  --parameters deployerObjectId="<object-id>"
```

### Production resources

The stack was **recreated with a new suffix**; every `gipkzrenusqpy` name below was verified
nonexistent on 2026-09-24. The live resources use `k2xoe7s452aja`:

| Resource | Name |
|---|---|
| Resource group | `rg-partyhause-prod` (same name) |
| ACR | `acrpartyhausek2xoe7s452aja` |
| Web app (PWA, live) | `ca-web-partyhause-k2xoe7s452aja` |
| API app (Express, live) | `ca-api-partyhause-k2xoe7s452aja` |
| Combined app (web + API, pending cutover) | `ca-app-partyhause-combined` |
| Postgres | `psqlph-k2xoe7s452aja` (note the hyphen), in **centralus**, not eastus2 |
| Storage | `stphk2xoe7s452aja` (plus an unrelated `stqssiweb`) |
| Web PubSub | `wps-partyhause-k2xoe7s452aja` |
| Key Vault | `kvphk2xoe7s452aja` |
| Container Apps env | `cae-partyhause-k2xoe7s452aja` |

The live topology is two apps, `ca-web-partyhause-k2xoe7s452aja` and
`ca-api-partyhause-k2xoe7s452aja` (verified against Azure on 2026-09-29: both
`Running`, both on image `:9238496ae40574b71f314caeccc788680e012200`, API
`/api/health` 200, web `/` 200). The single combined app above is declared in
Bicep (`infra/resources.bicep`, literal name `ca-app-partyhause-combined`) and
targeted by `scripts/deploy-full.sh`, `scripts/bind-azure-custom-domains.sh`
and `.github/workflows/deploy.yml`, but it has never been provisioned: no
`partyhause-combined` image has ever been pushed to ACR and `az containerapp
show -n ca-app-partyhause-combined` returns `ResourceNotFound`. An earlier
revision of this document claimed the combined app had been deployed since
2026-09-27; that was the plan misstated as fact. Do not repeat it.

Cutover order, when it happens: provision (Bicep creates the combined app
alongside the old two), build and push `partyhause-combined`, update the
combined app to the SHA tag, verify `/` and `/api/health` on its FQDN, re-bind
`partyhause.uk` and `www.partyhause.uk` with `npm run bind:domains`, verify
again on the custom domain, then delete the two old apps by hand. Bicep no
longer declares them, so a provisioning run will not remove them, and the DNS
`www` CNAME plus the apex `A` must move to the combined app as part of the
re-bind.

Container Apps env FQDNs use `orangecliff-6cf481f7`, not the old `calmtree-5b646dc8`:
- Web (live): `https://ca-web-partyhause-k2xoe7s452aja.orangecliff-6cf481f7.eastus2.azurecontainerapps.io`
- API (live): `https://ca-api-partyhause-k2xoe7s452aja.orangecliff-6cf481f7.eastus2.azurecontainerapps.io`
- Combined (pending): `https://ca-app-partyhause-combined.orangecliff-6cf481f7.eastus2.azurecontainerapps.io`
  (will serve both the static bundle and, through the nginx `/api/` proxy, the API on one origin)

**`partyhause.uk` serves the web app as of 2026-09-25.** The web Container App carries two custom
hostnames with managed certificates (`partyhause.uk` and `www.partyhause.uk`, both `SniEnabled`,
issued by DigiCert). After the combined app replaces the two-app topology, these hostnames must be
re-bound to `ca-app-partyhause-combined` with `npm run bind:domains`
(`scripts/bind-azure-custom-domains.sh`, updated to the live suffix and combined app name); the
Bicep templates do not declare them. The DNS zone lives in Cloudflare (`brady`/`tani` nameservers) and the records
are DNS-only, not proxied: the apex `A` points at the environment static IP `40.70.172.184` and
`www` CNAMEs directly to the web FQDN. Two rules keep the managed certificate alive: the records
must never be proxied through Cloudflare (an intermediate CNAME blocks DigiCert issuance and
renewal), and `TXT asuid.<hostname>` must carry the app's `customDomainVerificationId`
(`EDF7D9332018E7CF25F5A73A0F43C4EA166F5C47209663E2BB5E6DDCB920C631`). Before 2026-09-25 the apex
served an IONOS parking page through a stale proxied AAAA record and `www` pointed at the deleted
`gipkzrenusqpy` suffix; both were fixed imperatively and the stale records were deleted. The Bicep
templates do not declare these custom domains, so the next `az deployment sub create` will not
remove them, but a fresh environment will not have them either.

**`partyhause.com` is NXDOMAIN as of 2026-09-24.** The zone is not in the Cloudflare account
holding `partyhause.uk`; the domain is registered at Squarespace (expires 2027-09-14) with
Cloudflare nameservers, so the zone was deleted rather than moved. Until the zone is recreated
and records point at the web FQDN, the AASA and every emailed link to `partyhause.com` are dead.
The AASA itself serves correctly from the web FQDN and from `partyhause.uk`. Email on that zone
(MX `ionos.co.uk`, SPF, DMARC `p=none`) is configured separately from the web records.

**Production email sends from `noreply@partyhause.uk` (fixed 2026-09-28).** The API Container App
env is `ACS_SENDER_ADDRESS = noreply@partyhause.uk` (revision `--0000006`, `/api/health` reports
`provider: acs, sender: noreply@partyhause.uk`); the Resend fallback is
`PartyHause <noreply@partyhause.uk>`. Before this fix ACS sent from the managed domain
`DoNotReply@4e528ba9-....azurecomm.net`, because the custom domain's verification had failed: the
apex TXT `ms-domain-verification` in Cloudflare held the Container App's
`customDomainVerificationId` instead of the ACS token. The fix chain, all applied imperatively:
the TXT corrected to `ms-domain-verification=18e7a084-b769-44be-8340-4242e5621019`, Domain then
DKIM/DKIM2 then SPF re-verified in ACS, the MailFrom address `noreply` created, and the domain
linked to the Communication Service `acs-partyhause-k2xoe7s452aja` (its `linkedDomains` previously
listed only `AzureManagedDomain`, which is what "sender domain has not been linked" meant at send
time). Two sender-authentication facts that cost time: ACS exact-matches the SPF record, so the
apex SPF had to end `-all` (`~all` fails `DnsRecordsNotMatched`; the ionos include is kept, so
IONOS-sent mail keeps its alignment), and a domain cannot be linked to a Communication Service
until Domain, DKIM and SPF are all Verified. The Bicep tracks the new state:
`linkCustomEmailDomain` is declared in `infra/main.bicep` and set `true` in
`infra/main.parameters.json`, and the env ternary at `infra/resources.bicep:336-338` now resolves
to `noreply@partyhause.uk`. The two DKIM selector CNAMEs were already correct and DNS-only
throughout. A live send from `noreply@partyhause.uk` was verified `Succeeded` through the ACS SDK
in the same change.

Both container apps ran 0.5 vCPU, 1.0 GiB, `minReplicas: 1`, `maxReplicas: 3`. The combined app
inherits the same resource shape from the module defaults.

**`minReplicas` must stay in the template.** It was previously hardcoded to 0 in
`infra/modules/container-app.bicep`, fixed to 1 imperatively with `az containerapp update`, and
then silently reset to 0 by the next `az deployment sub create`. Measured effect of the regression
was 21 seconds to first byte on both tiers. It is now a parameter defaulting to 1. Never fix scale
settings on the live app alone.

### Infra hazards

- **AcrPull role assignment is off by default.** `manageAcrPullAssignment` defaults `false` and
  neither app passes `true`, so a fresh environment will not be able to pull images without setting
  it explicitly.
- **No health probes are defined**, despite the module comment claiming otherwise.
- **Storage allows public blob access** and `event-invites` is publicly readable.
- Key Vault uses access policies, not RBAC, and the deployer policy is skipped entirely when
  `deployerObjectId` is empty. Since 2026-09-27 the vault `kvphk2xoe7s452aja` holds all nine API
  secrets (postgres-password, database-url, storage-conn-str, webpubsub-connection-string,
  acs-connection-string, jwt-secret, invitation-token-secret, resend-api-key, azure-openai-api-key)
  and the API Container App's `secrets` array is Key Vault references resolved at run time through
  its system-assigned identity. The identity's vault policy is granted out-of-band, like AcrPull:
  `az keyvault set-policy -n kvphk2xoe7s452aja --object-id <api-app-principalId> --secret-permissions get list`.
  A fresh environment will not resolve secrets until that runs; the app crash-loops rather than
  booting with missing secrets. The Bicep secrets now reference the vault (see
  `infra/resources.bicep`), `scripts/create-api-containerapp.sh` reads every value from the vault
  at run time, and `infra/main.parameters.json` points at the current vault with the kebab-case
  secret names. It previously pointed at the deleted `gipkzrenusqpy` vault. The `entra-api-client-secret`
  parameter stays an inline empty value: the vault holds no entra secret and a reference to one
  that does not exist would fail every revision deploy.
- **A local `docker build` on this machine is arm64.** The machine runs Colima (not Docker
  Desktop) on Apple Silicon, so the 2026-09-24 fallback build pushed arm64 images to the SHA tags
  while the Container Apps environment is amd64. Any restart that re-pulled the tag crash-looped
  with `docker-entrypoint.sh: exec format error` while a stale cached replica kept serving. Every
  local image build must pass `--platform linux/amd64`, and buildx must be installed (Colima ships
  only docker and compose): `brew install docker-buildx && ln -sf "$(brew --prefix)/opt/docker-buildx/bin/docker-buildx" ~/.docker/cli-plugins/docker-buildx`.
  Plain QEMU emulation segfaults (exit 139) on `npm install -g tsx` under Node 22; colima started
  with `--vz-rosetta` runs amd64 containers through Rosetta and builds cleanly. The `default`
  docker context points at `/var/run/docker.sock`, which does not exist under colima; the `colima`
  context is the working one.

---

## CI/CD

### Git remotes: there is no `origin`

That is deliberate, and a bare `git push` still works because the branch tracking is set.

```
origin-CONTAMINATED-do-not-fetch-incident-20260827  /nonexistent/contaminated-remote-see-incident-20260827
upstream-clean                                      https://github.com/QuantmindSSI/Partyhause.git
```

**`upstream-clean` is the live remote.** It is reachable, and `test/browser-e2e` tracks
`upstream-clean/test/browser-e2e` with `branch.<name>.remote` set, so `git push` with no arguments
goes to the right place. Anything that hardcodes the name `origin`, including a script, a workflow
or a habit, will fail here rather than push somewhere wrong.

The other entry is a quarantined remote. Somebody renamed `origin` so the warning lives in the name
itself and repointed it at `/nonexistent/...`, which makes an accidental fetch or push fail
immediately instead of touching whatever it used to reference. That is the right shape for this:
impossible rather than discouraged.

**The incident it cites has no record anywhere in this repository.** A search for `20260827` and for
`contaminated` across the tree, excluding `node_modules` and `.git`, returns nothing. The remote's
own name is the only surviving description of why it was quarantined. If anyone still remembers
what happened on 2026-08-27, it belongs in `docs/` before that knowledge is gone; until then,
treat the quarantine as load-bearing and do not restore the remote to work out what it pointed at.

**Deploys do not come from a remote.** `az acr build` uploads the working directory, so what ships
is the local tree rather than anything pushed. That is why an unpushed commit can be running in
production, and it has happened: verify `git rev-list --count upstream-clean/<branch>..HEAD` before
assuming the deployed SHA exists anywhere but this machine.

### Workflows

Two workflows in `.github/workflows/`.

- **`ci.yml`** runs on PRs and non-main pushes: prisma generate, lint, `build:check`, `test:run`.
  Does not deploy.
- **`deploy.yml`** runs on push to `main`: the same gates, then optional Bicep provisioning, then
  `az acr build` for the combined image and a Container App revision update. Images are tagged
  `:latest` and `:<git-sha>`; the app is moved to the SHA tag so a deployment traces to a commit.
  The workflow builds the single combined image (`Dockerfile.combined`) and updates
  `ca-app-partyhause-combined`; `scripts/deploy-full.sh` is the manual path that matches it.

**GitHub Actions is currently billing-locked.** Every run since 2026-09-03T00:23 has failed with
*"The job was not started because your account is locked due to a billing issue"*, in 0 to 9
seconds, without compiling anything. The last green deploy was 2026-08-31. Until it is lifted,
deploys are manual — and the manual path is one script, `npm run deploy:full`
(`scripts/deploy-full.sh`), which runs the same gate chain `deploy.yml` runs before anything is
built (npm ci, prisma generate, test:migrations, lint, build:check, test:run, doctor:mobile,
iOS export), then builds the combined image inside ACR and moves the app to the SHA tag:

```bash
npm run deploy:full          # gates → az acr build --file Dockerfile.combined → az containerapp update → health checks
```

Before this script existed the manual path was a stack of raw `az acr build` commands with no
gates at all, so code that did not typecheck could ship to production. The script refuses to
proceed past any failing gate. If `az acr build` times out uploading the source archive to the
task blob (observed on 2026-09-24 and 2026-09-27), build locally and push instead — then run the
`az containerapp update` from the script by hand. On Apple Silicon every local build must pass
`--platform linux/amd64` (see the Colima hazard under Infrastructure):

```bash
az acr login -n acrpartyhausek2xoe7s452aja
docker buildx build --platform linux/amd64 -f Dockerfile.combined \
  -t acrpartyhausek2xoe7s452aja.azurecr.io/partyhause-combined:$SHA \
  -t acrpartyhausek2xoe7s452aja.azurecr.io/partyhause-combined:latest \
  --build-arg VITE_API_URL="" \
  --build-arg VITE_APP_NAME="PartyHause" \
  --build-arg VITE_APP_URL="https://partyhause.uk" \
  --push .
az containerapp update -n ca-app-partyhause-combined -g rg-partyhause-prod \
  --image acrpartyhausek2xoe7s452aja.azurecr.io/partyhause-combined:$SHA
```

The push step fails with `failed to fetch oauth token ... EOF` when the ACR login token has
expired (they last 3 hours); `az acr login` again and rerun the same buildx command, which
reuses the cached layers. Omit the `VITE_ENTRA_*` build args,
for the reason given under Auth.

### Serving topology: one app, nginx front door + Express sidecar (cutover target)

The target topology is **one Container App serving frontend and backend
together on one origin**. The image (`Dockerfile.combined`, `partyhause-combined` on ACR) runs:

- **nginx** on port 80 (the ingress targetPort), serving the static bundle with the full cache
  policy in `nginx.conf`, unchanged — and **proxying `/api/*` to the Express sidecar on
  `localhost:3001`** in the same network namespace.
- **Express** (`tsx server/index.ts`) as a sidecar, started by `docker/entrypoint.sh`, which
  waits for `/api/health` (bounded at 60s) before running nginx in the foreground under `tini`.

The prior topology was two apps joined only by a `VITE_API_URL` baked into the bundle plus a
CORS allowlist; one deploy moved the API and every client needed a rebuilt web bundle to follow
it. Here one revision update moves both tiers, the browser sends same-origin relative requests
(`VITE_API_URL` is passed empty — `src/lib/apiBase.ts:9-12` documents the empty-base contract),
and CORS stops mattering for the web app entirely.

Four things the combined image needed beyond the two Dockerfiles it replaced:

1. **`docker/entrypoint.sh` runs the server via the `tsx` CLI, not bare `node`.** The server
   imports its own modules without file extensions (`./lib/jwt-secret`), which ESM only resolves
   with a loader; tsx registers one when the CLI runs, and bare `node` fails with
   `ERR_MODULE_NOT_FOUND` on the first extensionless import. `tsx` is a devDependency, so the
   runtime stage installs it globally itself.
2. **Debian's `sites-enabled/default` is deleted.** The combined runtime is `node:22-slim`
   (Debian), not `nginx:alpine`, and Debian's nginx ships a demo server block carrying
   `default_server` on port 80 with `server_name _`. It wins over the `conf.d` server — nginx
   logs "conflicting server name" and ignores ours — so every request is answered from
   `/var/www/html` with the distro's default page and none of the cache policy applies.
3. **`COPY docker/entrypoint.sh` and `COPY package.json package-lock.json` in the runtime
   stage.** The entrypoint copy is what runs the sidecar; the package copy is what `npm ci`
   needs (bare `npm ci` with no lockfile fails with EUSAGE). Both were missing from the first
   cut of `Dockerfile.combined` and each failed the container at boot.
4. **`Acquire::http::Pipeline-Depth "0"` on the apt step.** apt's default pipelining against
   `deb.debian.org` (Fastly) intermittently corrupts fetched `.debs` here — file size matches
   the manifest, SHA256 does not, on a different package each run, and the build dies with
   "Hash Sum mismatch". Standalone `apt-get download` of the same package is byte-identical
   every time; disabling pipelining forces one request per file and the install passes.

**Verification of the merged container** (2026-09-27, against a scratch Postgres): static
`/` 200 text/html; `/api/health` through the proxy returns the real JSON; a missing asset
returns 404 (not the SPA shell); `/sw.js` `no-cache`; `/assets/*` `immutable`;
`/.well-known/apple-app-site-association` 200 application/json; `/join/:token` 200 with
`no-store` and `no-referrer`; signup → unverified login 403 → wrong password 401; and the
20/15-minute credential limiter engages through the proxy (18×429 after 25 requests).

### Serving rules the nginx config encodes

`nginx.conf` is the combined container's config, copied in by both `Dockerfile` and
`Dockerfile.combined` and validated by `RUN nginx -t` at build time. It exists because the
previous six-line inline config set no `Cache-Control` on anything, which left every URL to
heuristic browser caching and stranded service worker clients on a stale precache.
Fingerprinted assets are immutable for a year; `sw.js`, `registerSW.js`, `index.html` and the
manifest are `no-cache`; every file-serving location ends in `=404` so a missing asset cannot
be disguised as a 200 of `index.html`. The `location ^~ /api/` block hands `/api/*` to the
Express sidecar on `localhost:3001` — it only takes effect in the combined image, and in a
static-only build the same paths would 502. It is registered after the `.well-known` block and
before the SPA fallback; keep it there.

**`public/` must stay in the Docker build context.** It was excluded by `.dockerignore` for the
entire life of the Azure stack, so every icon, `robots.txt`, `privacy.html`, `terms.html` and
`support.html` returned `index.html` instead. A test in `src/test/bundle-chunk-graph.test.ts`
asserts `.dockerignore` does not re-exclude it.

---

## Mobile build path

There is no iOS build yet and nothing has been submitted. Most of the
scaffolding is in place; what is left needs accounts, not code.

**Ready.** `eas-cli` (24.7.0) is a devDependency; the `eas:*` scripts in
`apps/mobile/package.json` pin `npx eas-cli@23.2.0` explicitly and are
unaffected by it. Build profiles for `development`, `preview` and `production`
are configured with auto-increment on both platforms. Bundle identifier is
`com.partyhause.mobile` for iOS and Android. `NSContactsUsageDescription` and
`ITSAppUsesNonExemptEncryption: false` are declared in `app.config.ts`.

**Closed since this section was written, listed so nobody re-derives them:**

- **An EAS project exists.** `apps/mobile/app.json` carries
  `extra.eas.projectId` (a UUID) and `owner: quantumindssi`, written by
  `eas init`, satisfying `eas.json`'s `appVersionSource: "remote"`. Pinned by
  `src/test/eas-build-config.test.ts`.
- **Apple Team ID exists.** `eas.json` submit.production.ios carries
  `appleTeamId: "APRP2V384G"` and the AASA `appID` matches it.
- **Universal Links are configured against the live domain.** `associatedDomains` is
  `["applinks:partyhause.uk"]` and
  `public/.well-known/apple-app-site-association` exists, claims `/join/*`
  only, and is served by the web container. Guarded by
  `src/test/universal-links.test.ts`, including a negative assertion against
  the dead domain. It is live: `partyhause.uk` serves the web app and the
  association file (verified 2026-09-25), and the invitation emails link
  there. `partyhause.com` is NXDOMAIN since its zone was deleted on
  2026-09-24, so it can no longer back universal links; if that zone is ever
  recreated, add it back as a second `applinks` entry.
- **`npm run doctor:mobile` and `npm run build:ios:export` exist.** Both
  workflows referenced them before either script was written; both now do.
  The doctor is static (`scripts/doctor-mobile.cjs`, no Expo CLI, no mobile
  node_modules) and checks the identity files, their cross-file agreement and
  the AASA. The export self-installs `apps/mobile` when `node_modules/expo`
  is absent, then runs `npx expo export --platform ios`; verified producing a
  4.9 MB bundle.

**Still missing, and it needs you rather than a commit:**

| What | Why it blocks |
|---|---|
| App Store Connect app record | `ascAppId` cannot exist before the app record does. The Apple Developer Program membership is active (the bundle ID `com.partyhause.mobile` was registered under Team `APRP2V384G` on 2026-09-24); the record itself is created in the App Store Connect UI, and EAS submit resolves the app from the bundle ID once it exists |
| App Privacy section | Nutrition labels in App Store Connect. Not a repo artifact |
| Apple credentials for the production build | The Expo account session exists (`eas whoami` resolves `quantumindssi`, Owner). `eas build --profile production` and `eas submit` additionally need Apple Developer authentication (Apple ID with 2FA, or an App Store Connect API key) to mint the distribution certificate and profile; that handshake is interactive |

```bash
cd apps/mobile
npm run eas:login          # Expo account
npm run build:ios:preview  # first real artefact, simulator build
npm run build:ios:production
```

`submit.production.ios` now carries `appleTeamId` and nothing else, and that
is deliberate. It previously held placeholders
(`your-apple-id@example.com`, `REPLACE_WITH_APP_STORE_CONNECT_APP_ID`,
`REPLACE_WITH_TEAM_ID`). A placeholder there is worse than an omission: `eas
submit` reads it and fails against Apple with an authentication error that looks
like a credential problem rather than a configuration one. Omitted, EAS prompts
for each value and caches it, and the failure mode is "you have not supplied
this yet", which is true.

---

## Testing

47 files in `src/test/`, 473 passing and 13 skipped. Vitest with jsdom.

Notable suites: `bundle-chunk-graph.test.ts` guards the emitted Rollup chunk graph against import
cycles, which once shipped a white screen that returned HTTP 200, and asserts PWA manifest icons
resolve to real correctly-sized PNGs. `email-verification-gate.test.ts` covers the three auth
gates. `core-api-client.test.ts` covers transport retry bounds and 401 handling.
`partyboard-contract.test.ts` covers the board's validation and per-viewer vote projection.
`auth-session-roundtrip.test.tsx` pins the two-key session invariant at every site that mints one.
`landing-page.test.tsx` asserts that every call to action on the landing page reaches a destination,
which is the class of defect that page shipped with and nobody caught, because it had no coverage
at all until 2026-09-08.

The MVP suites arrived 2026-09-09. `mvp-contract.test.ts` and `mvp-command.test.ts` cover the
idempotency key and the expected-`revision` check, which are what stop a retried request applying
twice and two editors overwriting each other. `mvp-services.test.ts` and `mvp-invitations.test.ts`
cover the services. `mvp-router.test.ts`, `account-router.test.ts` and `rsvp-router.test.ts` cover
the HTTP surface. `auth-revocation.test.ts` pins the `token_version` epoch, including that reset
issues a token from the *new* epoch rather than the stale one. `legal-surfaces.test.ts` asserts the
server, client and published documents all name the same version, and that no retired vendor
reappears in a legal page.

The RSVP account rule landed 2026-09-15. `rsvp-service.test.ts` covers the three ways an answer is
refused (no session, wrong address, seat already claimed), the anonymous default path, and that the
authorization check runs *before* the idempotent early return, so an unauthorized caller cannot
learn the stored answer by submitting each status in turn. `rsvp-router.test.ts` covers the
public-read / bound-write split. `join-event-page.test.tsx` covers the browser flow, including that
the event is rendered to a signed-out visitor before they are asked to register.
`invited-signup-postgres.integration.test.ts` covers every branch of the auto-verify decision.

The 5 skipped files are Postgres integration suites, gated on `DATABASE_URL` being set. They pass:
run `npm run test:migrations` first, then `DATABASE_URL=... npx vitest run src/test/*.integration.test.ts`.
Give them a scratch database and run with `--no-file-parallelism`: they share tables and
`account-deletion-postgres.integration.test.ts` currently fails its own teardown on
`events_host_id_fkey`, which predates the RSVP work and is unrelated to it. The other skips are live
email tests requiring a running API.

**The three `e2e-*.mjs` scripts below do not currently run on this machine.** All of them die at
`server/routes/guests.ts:15` with *"'@partyhause/core/contracts' does not provide an export named
'guestCreateBatch'"*, under both Node 24 and Node 26. It is not a Node version issue and not caused
by any uncommitted work: a clean `git worktree` at HEAD reproduces it exactly. The same import
resolves fine under `npx tsx -e` and under vitest, so the fault is in how the `.mjs` entry points
load `server/index.ts`. Until that is fixed, route-level authorization has to be asserted through
the Postgres integration suites instead.

### Tests that need a database

Vitest runs under jsdom with no Postgres, so route-level authorization and persistence cannot be
asserted there. Three scripts boot the real Express app against a real database. Each sets
`NODE_ENV=test` rather than `production`, which is what makes the server print auth links to its
log; that is how they obtain real tokens with no mail provider configured, and it is suppressed in
production on purpose.

| Script | Covers | Checks | Deletes |
|---|---|---|---|
| `e2e-auth-journey.mjs` | signup and its consent gate, storage, the verification gate, verification, login, token revocation, `/api/auth/me`, `/api/users/:id`, profile update, a second viewer, logout | 116 | two `journey.*@partyhause.local` accounts |
| `e2e-account-recovery.mjs` | the user who never confirms and forgets their password | 22 | one `never-confirmed@recovery.local` account |
| `e2e-partyboard.mjs` | all seven `/api/partyboard` routes plus authorization | 56 | **truncates** users, events, guests, partyboard tables |

Only `e2e-partyboard.mjs` truncates. The other two delete their own named accounts and nothing
else. Point all three at a scratch database regardless.

```bash
brew services start postgresql@18
createdb partyhause_dev
DATABASE_URL="postgresql://$USER@localhost:5432/partyhause_dev?schema=public" npx prisma migrate deploy
npx tsx scripts/e2e-auth-journey.mjs
npx tsx scripts/e2e-account-recovery.mjs
npx tsx scripts/e2e-partyboard.mjs
```

The connection string needs an explicit username. Omitting it makes Prisma answer `P1010: User was
denied access`, which reads like a permissions problem and is not one.

`e2e-auth-journey.mjs` deletes `AUTH_BYPASS` from the environment before importing the server. The
bypass is enabled by `dev-api.ts` and would admit unauthenticated requests as the synthetic dev
user, making every authorization check in the script pass for the wrong reason.

---

## Known gaps and hazards

Ranked by consequence.

1. **The iOS gap register predates the last four days of work.**
   `docs/mobile-ios-launch/08-current-state-gap-register.md` records 93 gaps, 68 marked BLOCKER,
   each with file:line evidence. Several are now fixed and the file has not been re-run. Verify any
   entry against the code before acting on it; that is the standing rule for this whole repository,
   and this document is no longer the exception it used to be.
2. **About 3,600 lines of mobile TypeScript are unreachable**, 15% of the app's 23,491 lines, across
   19 files. The largest are `components/screens/GuestManagementScreen.tsx` (722),
   `components/EventPlanningBoard.tsx` (672), `components/screens/EventCreationScreen.tsx` (438),
   `constants/design-system.ts` (429) and `components/screens/EventDetailsScreen.tsx` (405), each
   superseded by a route under `app/`. The figure was 8,637 until 2026-09-08, when the
   `components/partyhub/` poll and idea subsystem, its `PollSticky.backup.tsx`, the `_deferred/`
   games screens and an unreferenced `BirthdayForm.tsx` were deleted. Measured by walking imports
   from every file under `app/`, since expo-router treats each as an entry point. Platform-variant
   files (`*.ios.tsx`, `*.web.ts`) and build configs are excluded, because that walk cannot see the
   loader that reaches them.
3. **One mobile screen still pushes to a route that does not exist**: `/settings/profile`
   (`profile/[id].tsx:73`), and there is no `app/settings/`. The other two went on 2026-09-08:
   `/events/:id/games` and `planning` were removed from `events/[id]/_layout.tsx` along with the
   card and the screens behind them.
4. **Three empty `onPress` handlers ship on tappable UI**: `events/[id]/activities.tsx:226` and
   `:259`, and the Edit event control at `events/[id]/index.tsx:568`. Three others were closed on
   2026-09-08, Cancel Event by implementing it and the Media and Vendors cards by deletion, since
   the server mounts no router for either.
5. **Two HTTP clients**, described under Repository layout.
6. **Web routing is split** between React Router, which owns 8 paths, and a `currentPage` string
   state machine behind `path="*"`. The state type ends in `| string`, so the literal set is not
   enforced. Four handled keys have no setter: `logout`, `guest-view-*`, `role-selection` and
   `games`. Six vendor keys were removed on 2026-09-07 when the buttons that set them were deleted.
7. **Five routers have no web consumer**: `timeline`, `event-templates`, `connections`,
   `cost-split` and, on mobile only, `ai`. `cost-split` has full CRUD and no UI on either client.
   `timeline` is bypassed deliberately and `src/lib/timeline.ts:17` explains why.
8. **424 lint warnings**, mostly `no-explicit-any`. Zero errors.
9. **`build.target` is `esnext`**, so nothing is downlevelled. `Object.hasOwn` (Safari 15.4+) is
   already present in two eagerly loaded chunks.
10. **`Dockerfile:26` mutates `tsconfig.json`** during the web build, so the image build differs
    from a local `npm run build:web`.
11. **`app.set('trust proxy', 1)` is called twice** in `server/index.ts`.
12. **`apps/mobile/app.json` and `app.config.ts` conflict.** `app.config.ts` spreads `...config`
    then overrides name, slug and scheme, and replaces the plugin list wholesale, which silently
    drops `react-native-reanimated/plugin` declared in `app.json`.

### Deferred on 2026-09-09, on branch `mvp-stash-snapshot` (since landed)

**Both deferred layers have since merged into this branch** (via `ceb756c` and the branch history
of `test/browser-e2e`), so the text below is now the historical record of the deferral decision, not
a description of the current tree. The mobile app in this tree is Expo SDK 57, React Native 0.86,
TypeScript 6.0. This section is kept because it explains why the layers were separated at all.

The iOS-MVP work arrived as one 249-file change containing four separable layers. The migrations
and the `/api/mvp` domain landed. Two layers did not, and they are not abandoned: they are on
`mvp-stash-snapshot` (`9103199`), which is a branch precisely so it stops being a stash entry that
one `git stash drop` would erase.

**The mobile MVP, entangled with Expo SDK 54 to 57.** It deletes about 70 files, including the
whole 14-file template-forms subsystem, the event-creation wizard, `activities.tsx` and
`profile/[id].tsx`, and adds account, invitations and session screens. That resolves gaps 2, 3 and
4 by deletion rather than by wiring, which for an MVP is the better answer. It cannot be taken
piecemeal: `expo-secure-store@57` targets SDK 57, and the branch also moves React Native 0.81 to
0.86 and TypeScript 5.9 to 6.0. Verifying it needs an actual iOS build, which needs the EAS project
and Apple Team ID listed under Mobile build path.

**The web dependency upgrade.** React 18 to 19, `@tanstack/react-query` v4 to v5,
`react-day-picker` v8 to v9, `lucide-react` 0.279 to 1.41, `framer-motion` 10 to 12, Node 18 to 22,
and consolidation onto a single root lockfile with `apps/mobile/package-lock.json` deleted. That
last part fixes the documented hazard that the mobile lockfile does not satisfy its manifest.

Only one file couples the web app to that upgrade: `src/components/ui/calendar.tsx` uses the
react-day-picker v9 API. Reverting that single file made the entire branch typecheck and pass
against the current dependency tree, which is how the layers were shown to be separable rather than
assumed to be. Take it as its own change, with a browser rather than jsdom as the evidence.

### Fixed on 2026-09-08

`POST /api/auth/reset-password` now returns `user` alongside `token`, matching the login response.
It was token-only, and the web client stores the token and the cached user under two separate keys
and hydrates only when both are present, so a successful password reset wrote a valid session the
app rendered as signed out. The comment above the call read "sign the user in" and it did not.
`src/pages/ResetPasswordPage.tsx` now writes both halves.

The landing page was rebuilt against `docs/BRAND.md`. Two of its calls to action were inert: they
called `setCurrentPage('dashboard')`, which for a signed-out visitor matches no branch in
`App.tsx`'s mode effect, so the page re-rendered itself. Below the `md` breakpoint the navigation
was `hidden md:flex` with no alternative, so every destination in the header was unreachable on a
phone. There was no footer, so `privacy.html`, `terms.html` and `support.html` could only be
reached by typing the URL. `.hover-lift` was applied in three places and is defined nowhere in the
repository. Every call to action produced the `create_event` intent, so two thirds of `AuthScreen`'s
intent-specific copy was unreachable from the only page that can reach it.

On mobile, Cancel Event now writes. Its confirmation dialog warned the action "cannot be undone"
and then ran an empty `onPress`. It writes `archived` rather than `cancelled`, because the CHECK
constraint on `events.status` does not accept the latter, and it is guarded against a double tap.
`CorporateForm` became reachable: `TemplateForm.tsx` had routed `case 'corporate'` to a complete
form since the forms were written, but the wizard's `TEMPLATES` array carried no `corporate` entry,
and that array drives both the rendered choices and the lookup.

The Media and Vendors cards were deleted rather than wired, and the Games card with them. The first
two had empty handlers and no route to call, since the server mounts no `/api/media` or
`/api/vendors`; the third pushed to `/events/:id/games`, whose screens sat in `_deferred/`. A card
that reports a count and does nothing when tapped reads as a loading bug, not an unbuilt feature.
`app.config.ts` no longer publishes an `extra` block holding two empty strings read from unset
environment variables.

### Fixed on 2026-09-07, listed so nobody re-reports them

`/api/partyboard` now exists; the canvas was calling a router that was never written and every
sticky was discarded. The create-event AI planner calls `/api/ai/chat` instead of a `setTimeout`.
The Guest List no longer ships a "Test Email" button addressed to a developer's personal inbox.
`VendorDashboard` says the marketplace is unbuilt instead of reporting $0 revenue. The mobile
invite flow reads the real event and the real guest list instead of four fabricated `@example.com`
recipients, and its send now passes all three of `/api/send-email`'s gates. Both AI and email rate
limiters keyed on a raw `req.ip`, which gave any IPv6 caller 2^64 buckets.

---

## Documentation map

All 187 markdown files were audited against the code on 2026-09-04 and **97 were deleted**: 79 that
presented Supabase, Netlify or Vercel as live infrastructure, and 18 that a newer document already
covered. 91 remain.

| Class | Count | How to read it |
|---|---|---|
| CURRENT | 17 | Accurate. Use it |
| HISTORICAL | 41 | Accurate as a record of its date. Never as instruction |
| NON-TECHNICAL | 32 | Marketing, brand, GTM. Not engineering material |

The historical set is deliberately unedited. Several describe Supabase or MailerSend, because that
is what ran at the time; rewriting a record to match today falsifies it. Read the date written
inside the document, not the one git reports: a repo-wide `PartyHaus` to `PartyHause` spelling
replacement stamped 2026-08-30 onto files it never read.

Deletion was preferred to rewriting. 97 replacement documents that could not be grounded in code
would have been a larger version of the same problem. Anything worth keeping was restated here from
the source.

[`docs/README.md`](./docs/README.md) carries the per-file classification. Trust these, in order:
this file, then `docs/mobile-ios-launch/`, then `docs/BRAND.md`, `docs/SHARED_API_CLIENT.md`,
`docs/LOCAL_DEV_AUTOSYNC.md` and `docs/WEBMCP_MONITORING.md`.

When you find a document that contradicts the code, fix the document or mark it stale in the same
change. Documentation debt is why this file had to be rewritten from scratch.
