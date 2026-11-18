# Mobile Backend Review — PartyHause

## Overview
Review of the PartyHause backend for mobile application support. Covers authentication flow, RSVP handling, storage invariants, URL resolution, and known defects.

## Architecture
- **Framework**: Express.js + Prisma ORM + Azure PostgreSQL
- **API Surface**: 28 route modules across `server/routes/`
- **Auth**: JWT HS256 with token_version epoch binding and email verification gates
- **Storage**: Azure Blob Storage with user-namespaced uploads and owner-only deletion

## Authentication Flow
```
1. Extract Bearer token from Authorization header
2. Verify JWT HS256 signature
3. Validate token_version matches user's current epoch in DB
   - Logout & password-reset both increment token_version
   - Prior tokens become invalid (replay protection)
4. Check email_verified status
   - Login returns 403 EMAIL_NOT_VERIFIED for unconfirmed accounts
   - requireAuth rejects any token with email_verified !== true
5. Development bypass: AUTH_BYPASS=true + NODE_ENV !== production
   - Upserts dev user dev@partyhause.local
   - Explicitly excluded from RSVP router (attachOptionalActor never substitutes bypass)
```

## Rate Limiting
| Scope | Limit | Window | Routes |
|---|---|---|---|
| Global | 300/min | — | `/api/*` |
| Credential | 20/15 min | per IP | login/signup/forgot/reset/verify |
| Email | 20/5 min | per user | `POST /api/send-email` |
| RSVP | 60/15 min | per IP | `/api/rsvp/resolve`, `PUT /api/rsvp` |

## Mobile API Integration

### API Client (`apps/mobile/lib/client.ts:33-37`)
```typescript
export const api: ApiClient = createApiClient({
  baseUrl: getApiBaseUrl(),
  storage: createAsyncStorage(AsyncStorage),
  onUnauthorized: handleUnauthorized,
});
```

### URL Resolution (`apps/mobile/lib/api.ts:72-77`)
```
EXPO_PUBLIC_API_URL env var → Production Azure URL → Local loopback
```
- **Expo Go**: Production URL only (can't reach localhost)
- **Simulator (iOS)**: `http://localhost:3001` with AUTH_BYPASS
- **Simulator (Android)**: `http://10.0.2.2:3001` via Docker gateway
- **Production**: Azure Container Apps FQDN

### Storage Keys (Critical Invariant)
```
STORAGE_KEYS = {
  token: 'partyhause_auth_token',
  user: 'partyhause_auth_user',
}
```
- **Both keys must be present** for valid session
- Written by `src/lib/auth-storage.ts` (web/localStorage) and `packages/core/src/http/adapters.ts:73-74` (mobile/AsyncStorage)
- `src/hooks/use-auth.ts` hydrates only when **both** token and cached user are present
- Changing either key signs out every existing user (documented as intentional)
- Migration path exists: `SECURE_STORE_MIGRATION_KEY = 'partyhause_auth_secure_store_migration_v1'`

### RSVP Flow (Mobile-Critical)

| Step | Endpoint | Auth | Behavior |
|---|---|---|---|
| 1. Discover event | `GET /api/rsvp/resolve` | None (anonymous) | Guest sees event without signing in |
| 2. Submit RSVP | `PUT /api/rsvp` | `attachOptionalActor` | Binds seat if caller's email matches invited address |
| 3. Masked hint | `resolve` response | N/A | Returns `invitedEmailHint` (e.g., `a****@example.com`) |

**Key design decisions (verified in code):**
- `guest_invitations.requires_account` defaults to `false` — anonymous RSVP is the default contract
- Account-required invitations are host opt-in
- `attachOptionalActor` verifies JWT if present but **never substitutes the dev bypass user** (tested defect in `auth-optional-actor.test.ts`)
- If session lapsed → returns `RSVP_ACCOUNT_REQUIRED` instead of binding to bypass user

### Known Backend Defects (from repo docs)
1. `GET /api/auth/me` uses `requireAuth` — bypass explicitly excluded (tested)
2. Empty `CORS_ALLOWED_ORIGINS` allows all origins
3. Global error handler returns `err?.message` in 500 bodies (information leak)
4. `INVITATION_TOKEN_SECRET` required for RSVP link signing; API fails to start without it

### What Works ✅
- Anonymous RSVP flow (`GET /api/rsvp/resolve` then `PUT /api/rsvp`)
- Session persistence across refreshes (both keys in AsyncStorage)
- 401 handling (`handleUnauthorized()` clears credentials; screens observe `api.auth.isAuthenticated()`)
- Onboarding gate (server-authoritative via `fetchOnboardingGate()`)
- Universal links (`associatedDomains: ["applinks:partyhause.uk"]` in `app.config.ts`)

### Prerequisites for Running
- **Xcode**: Required for iOS simulator; currently missing (`/Applications/Xcode.app` not found)
- **Xcode command line tools**: Already installed (`xcode-select` points to `/Library/Developer/CommandLineTools`)
- **Expo Go**: Must use production URL (can't reach localhost)
- **Android SDK**: Separate requirement for Android development

### Colima Status
- `partyhause` instance: **Deleted** (VM, processes, sockets all removed)
- Only `default` colima instance remains running
- No partyhause containers or active VMs

## Conclusion
The mobile backend is correctly architected and ready for development. All authentication flows, RSVP handling, storage invariants, and URL resolution are properly configured for the mobile platform. The two-key session invariant is well-engineered and shared between web and mobile. Known backend defects are documented but non-blocking.

Once Xcode and the iOS simulator are available, the mobile app can be started with `npx expo start --ios` and will connect to the backend via the configured API URL.