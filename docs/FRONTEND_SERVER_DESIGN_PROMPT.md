# LLM Design Prompt: PartyHause Frontend Server

Copy the block below (between the fences) into an LLM to generate the frontend server design for PartyHause. It captures the full backend contract, brand system, page/screen inventory, feature set, and constraints verified against the codebase on 2026-09-04.

---

## Role

You are a senior frontend architect designing a production frontend server (web + shared UI layer) for **PartyHause**, an event planning and collaboration application. The frontend must adapt to an existing **Django backend** and run against a **local development stack** (PostgreSQL + Django + Mailpit via docker-compose). Design all pages and screens, the theme/color system, onboarding flow, dashboard, AI chat planner, event templates and template forms, and the remaining feature surface (guests, invitations, RSVP, check-in, account settings, notifications, mind-map planning, vendor collaboration).

## Critical constraints (load-bearing, verified against AGENTS.md)

1. **Backend is Django 4.2.30 on port 8001.** Gunicorn. All API routes under `/api`. The frontend's only backend is Django on 8001. Vite proxies `/api` → `http://localhost:8001`. Keep `VITE_API_URL` empty so requests are same-origin relative paths that Vite proxies. Do **NOT** add routes to the retired Express server in `server/` (port 3001) — add Django routes in `django/` and register in `django/partyhause/urls.py`.

2. **Supabase is removed.** AGENTS.md explicitly states: "Supabase is gone, including the name." The SDK was never installed; it is absent from every package.json, both lockfiles, and node_modules. The last references were removed on 2026-09-08. `src/lib/supabase.ts` is now `src/lib/auth-storage.ts` and exports only five localStorage helpers. **Do not design the frontend around Supabase auth, Realtime, or Storage.** If the user still wants a Supabase local container running alongside Django (e.g. for vector search or future RAG), treat it as a separate optional service, not the auth/storage layer. The real local dev stack is: PostgreSQL 15 (db:5434), Mailpit (SMTP:1025, UI:8026), Django API (:8001), Vite web (:5173) — see `docker-compose.yml`.

3. **Auth is self-hosted JWT HS256**, bcryptjs cost 12. Claims: `{ sub, email, name, email_verified }`. Lifetime from `JWT_EXPIRES_IN` (default 7d). Secret from `server/lib/jwt-secret.ts` (production throws if empty, equals dev fallback, or < 32 chars). Email verification enforced at three points: (a) signup returns no token, (b) login rejects unverified with 403 `EMAIL_NOT_VERIFIED`, (c) `requireAuth` rejects tokens whose `email_verified` claim is not `true`. Tokens carry `token_version`; logout/password-reset increment the epoch. `POST /api/auth/resend-verification` is anonymous by design.

4. **Two API generations coexist.** The flat `/api/*` routers are what the web app uses today. The `/api/mvp` surface (added 2026-09-09) is what the iOS app is being built against; it does not replace the flat routers. A new capability belongs on `/api/mvp`. Do not add to both.

5. **Stack:** React 18.3.1, TypeScript 5.9.3, Vite 7.1.9, Tailwind CSS 3, shadcn/ui on Radix, framer-motion, Zustand (one persisted store) + TanStack Query v4. `vite-plugin-pwa`. `build.target` is `esnext` (no downleveling). `Object.hasOwn` (Safari 15.4+) is already present in eagerly loaded chunks. Node 20 builds/runs (manifest says >=18, pinned 18.18.0, workflows use 20).

6. **Realtime is native WebSocket**, not socket.io. `GET /api/realtime/negotiate` (requires auth) returns a Web PubSub client URL with a 60-minute token. Browser opens `new WebSocket(url, 'json.webpubsub.azure.v1')`. Server broadcasts `{ event, data }` envelopes via `sendToAll`. Hub name `WEBPUBSUB_HUB` or `partyhause`. Negotiate returns 503 when connection string unset; client falls back to polling.

7. **Storage:** Uploads go through the API, not direct to blob. multer memory storage, 5 MB cap, MIME allowlist jpeg/png/webp/gif. Container `event-invites` has public blob read; `uploads` does not.

8. **Two localStorage keys are a compatibility surface:** `partyhause_auth_token` and `partyhause_auth_user`. Written by `src/lib/auth-storage.ts` and independently by `packages/core/src/http/adapters.ts:73-74` (mobile). A session is the conjunction of both; `use-auth.ts` hydrates only when token and cached user are both present. Any path that writes one without the other produces a valid session the app renders as signed out.

9. **424 lint warnings, zero errors.** Mostly `no-explicit-any`. Do not introduce new lint errors.

10. **`packages/core` is consumed by mobile only.** Web runs a separate client at `src/lib/api-client.ts`. Treat any API contract change as a two-site change until clients are unified.

---

## Brand / design system (from docs/BRAND.md, v1.1, amended 2026-10-12)

The visual identity is **not yet wired into the app** — the frontend must implement it. Assets exist as real files in `public/brand/`.

- **Primary color:** `#FF5233` coral (`--primary`). Logo house mark: `#6C63FF` periwinkle. PWA `theme_color`: `#6366F1`. These three competed; pick one canonical system and document it.
- **Typography:** compute every contrast ratio; nothing asserted from memory. Section 12 / 12.7 gives component-level requirements from three reference mockups.
- **Motion:** page transitions 300 ms with 20 px y offset (`src/App.tsx:268-275`); card hover spring stiffness 300 / damping 20 (`src/lib/animations.ts:23-25`); list stagger `index * 0.1`; `prefers-reduced-motion` honored globally at `src/index.css:232-241`. Logo mark may animate its roof (lifting on entry, spring, settling); wordmark does not animate. Retire the pulsing `drop-shadow` on the hero title (`src/components/AuthScreen.tsx:213-220`).
- Logo lives in `public/brand/`. Migration specified in BRAND.md section 10.

---

## Pages and screens to design

Every item below must be produced as an explicit screen/page spec (path, component name, auth requirement, purpose, HTTP methods called, request/response shapes, loading/error/empty states, mobile/web variant). Do not group multiple screens into one bullet; list each separately.

### 1. Signed-out / marketing pages (web) — no session required

| # | Page | Path | Component | Purpose |
|---|------|------|-----------|---------|
| 1 | Landing page | `/` | `AuthScreen` (mode `landing`) | Hero with brand lockup, CTAs mapped to intents (`create_event`, `explore`, `auth`), feature sections, footer with Privacy/Terms/Support links. All CTAs must reach a real destination (none inert). Below `md` breakpoint the navigation must not be `hidden md:flex` with no alternative. |
| 2 | Auth screen — signup | `/auth` | `AuthScreen` (mode `auth`) | Create account with email, password, name, consent. Returns no token until email confirmed. |
| 3 | Auth screen — sign-in | `/auth` | `AuthScreen` (mode `auth`) | Email + password sign-in. 403 `EMAIL_NOT_VERIFIED` → offer resend, not password reset. 401 → wrong password. |
| 4 | Auth screen — forgot-password | `/auth` | `AuthScreen` (mode `auth`) | Request password reset link. Anonymous endpoint; answers identically whether or not address exists. |
| 5 | Auth screen — reset-password | `/auth` | `ResetPasswordPage` | Second step: `{ token, email, password }`. Writes both storage keys on success. |
| 6 | Auth screen — verify-email | `/auth/verify-email` | `VerifyEmailPage` | Complete email-verification loop using token + email from the confirmation link. |
| 7 | Browser RSVP page | `/join/:token` | `JoinEventPage` | Anonymous, public-read / bound-write split. Renders event facts to a signed-out visitor before asking to register. `no-store` + `Referrer-Policy: no-referrer`; masked email hint `a****@example.com`; never the full address. Reachable via invitation email link only. |

### 2. Onboarding journey (web) — shown after first login, before dashboard

The journey is a multi-screen funnel mounted inside `ProtectedRoute` via `OnboardingGate`, which reads `show_picker` / `onboarding_required` from `GET /api/users/me/onboarding`. Fail-open: if the status request fails, children render. Never a blank screen during retry. `GET /api/users/me/onboarding` returns `{ step, answers, onboarding_required }`.

Every screen below is explicit: path, component, data collected (DB field mapping), validation, and next-step behavior. Fields marked **required** block progression; optional fields may be skipped.

| # | Screen | Path | Component | Data collected (DB field) | Required? | Validation |
|---|--------|------|-----------|---------------------------|-----------|------------|
| 8 | Welcome | `/onboarding/welcome` | `OnboardingWelcome` | None — intro + value prop ("Plan events, build crew, own your social calendar") | No | None |
| 9 | About you — name | `/onboarding/name` | `OnboardingName` | `display_name` (UserProfile.display_name) | Yes | 2–100 chars, no HTML |
| 10 | About you — birth date | `/onboarding/birth-date` | `OnboardingBirthDate` | `birth_date` (UserProfile.birth_date) | Yes | Real calendar date, never future; must be ≥18 years (18+ gate for party culture app) |
| 11 | About you — location | `/onboarding/location` | `OnboardingLocation` | `location` (UserProfile.location) | No | Free text, city + optional region/country; debounced geocode suggest optional |
| 12 | About you — bio | `/onboarding/bio` | `OnboardingBio` | `bio` (UserProfile.bio) | No | Max 280 chars; plain text only |
| 13 | Account type | `/onboarding/account-type` | `OnboardingAccountType` | `account_type` (UserProfile.account_type: personal/business/creator) | Yes | Single select; business/creator unlock pro-oriented upsell later |
| 14 | Interests | `/onboarding/interests` | `OnboardingInterests` | `interests` (UserProfile.interests String[]) + `event_interests` (OnboardingResponse.event_interests String[]) | Yes (min 1) | Closed taxonomy of event-type chips: Birthday, Wedding, Corporate offsite, Group travel, Festival, Conference, Fundraiser, Block party, Hackathon, Product launch, Workshop, Other. Min 1, max 5. |
| 15 | Organizer profile | `/onboarding/organizer` | `OnboardingOrganizer` | `organizer_type`, `events_per_year`, `typical_guest_count` (OnboardingResponse) | No | Multi-select organizer type (social host, professional planner, venue, creator, business); events/year tier; guest count band (1-10, 11-30, 31-50 cap) |
| 16 | AI preferences | `/onboarding/ai-preferences` | `OnboardingAIPreferences` | `ai_before`, `ai_during`, `ai_after` (multi-select arrays), `autonomy_level` (suggest/draft/act_with_approval/act_autonomously), `agentic_wants` (String[]) (OnboardingResponse) | No | autonomy_level single-select; ai_* arrays multi-select lifecycle stages |
| 17 | Marketing consent | `/onboarding/marketing` | `OnboardingMarketing` | `marketing_opt_in` (UserProfile.marketing_opt_in + OnboardingResponse.marketing_opt_in) | No (opt-in) | Toggle default OFF. "Get tips, event inspiration, and partner offers." Links Terms + Privacy. |
| 18 | Privacy defaults | `/onboarding/privacy` | `OnboardingPrivacy` | `is_private`, `show_attending_events`, `show_partycrew_list`, `show_activity_status` (UserProfile) | No | Booleans, all default false except show_attending_events=true |
| 19 | Handle (username) | `/onboarding/username` | `UsernamePicker` | `username`, `username_normalized` (UserProfile); `username_set_at` set on choice | Yes | 3–30 chars, `^[a-zA-Z0-9_]+$`, normalized = lower(username), unique (call `GET /api/users/username-available?username=` debounced 400ms). Server's own refusal message shown on conflict. 30-day change cooldown starts at pick. |
| 20 | Complete | `/onboarding/complete` | `OnboardingComplete` | Sets `OnboardingResponse.completed_at`; clears gate | Yes | Summary card of chosen interests + account type; "Go to dashboard" CTA |

**Gate behavior:** `onboarding_required=true` → the picker cannot be skipped; the user lands on step 8 (welcome) after every login until step 20 completes. `onboarding_required=false` (legacy accounts) → dismissible prompt; `onboarding_skipped_at` records dismissal.

**Skipping:** `POST /api/users/me/onboarding/skip` sets `onboarding_skipped_at`; allowed only when not required.

**Data integrity:** Every screen's answers persist to `OnboardingResponse.responses` (JSON) plus typed columns as above. `schema_version` must be set on write so answer shapes can be migrated later. Never store full email or PII in `responses` beyond what's needed.

**Why this data matters for the product:**
- **Personal** (name, birth date, location, bio, avatar) → profiles, guest-list display, age-gated features, local event discovery.
- **Account type** (personal/business/creator) → paid-tier segmentation, pro features, invoice/billing path.
- **Interests + organizer profile** → template recommendations, AI planner pre-selection, crew matching, suggested events.
- **AI preferences** → which lifecycle stages the AI assistant is enabled for, and how autonomous it may act.
- **Marketing opt-in** → email/newsletter consent (Resend/ACS), must be opt-in only.
- **Privacy defaults** → who can see your attending events, partycrew list, activity status.
- **Username** → public handle `@handle`, used in URLs, mentions, and RSVP attribution.

### 3. Signed-in dashboard pages (web) — verified session required

| # | Page | Path | Component | Auth | Purpose |
|---|------|------|-----------|------|---------|
| 11 | Dashboard | `/dashboard` | `Dashboard` | Verified | Creator studio vs attendee view. Upcoming events, total guests, quick-create, event cards, pastel cards. `PageShell` with `BrandLockup` title and `UserMenu` actions (settings button). Creator sees event management; attendee sees RSVP/invitation surfaces. |
| 12 | Settings page | `/settings` | `SettingsPage` | Verified | Account facts, avatar upload (5 MB cap, MIME allowlist jpeg/png/webp/gif), username, email, legal links, support, sign-out, account deletion (`DeleteAccountCard`), `useOnboardingState`. |
| 13 | Profile page | `/users/:id` | `ProfilePage` | Verified | `GET /users/me/profile`, `PUT /users/me/profile`. Public-facing profile of a user. |
| 14 | Explore page | `/explore` | `ExplorePage` | Optional | Public event discovery. Note: public discovery is absent/unbuilt in iOS MVP; web may surface it carefully. |
| 15 | Social feed page | `/feed` | `SocialFeedPage` | Verified | Crew activity feed. |
| 16 | Notifications page | `/notifications` | `NotificationsPage` | Verified | `GET /notifications`, unread count, mark read. |
| 17 | Privacy settings page | `/privacy-settings` | `PrivacySettingsPage` | Verified | Privacy preferences. |
| 18 | Role selection | `/role-selection` | `RoleSelection` | Verified | Role picker (user/creator/vendor). Vendor role marked "not built yet". |
| 19 | Logout | `/logout` | `Logout` | Verified | Clears both storage keys, navigates to `/auth`. |

### 4. Event lifecycle pages (web + shared)

| # | Page | Path | Component | Auth | Purpose |
|---|------|------|-----------|------|---------|
| 20 | Event create wizard | `/create-event` | `EventCreation` | Verified | Wizard; on `/api/mvp` requires `Idempotency-Key` header and expected `revision` (stop retried request double-applying, stop two editors silently overwriting). Shows Template Picker first. |
| 21 | Event management | `/event-management` | `EventManagement` | Verified | List of owned events; launch create/edit/delete. |
| 22 | Event details | `/events/:id` | — | Verified | `GET /api/events/:id`. Read-only view of event facts. |
| 23 | Event edit | `/events/:id/edit` | — | Verified | `PUT /api/events/:id`. Update event fields (draft/completed/cancellable transitions only; published deletion requires cancel first). |
| 24 | Event publish | `/events/:id/publish` | — | Verified | `POST /api/mvp/events/:id/publish`. Move draft → published. |
| 25 | Event cancel | `/events/:id/cancel` | — | Verified | `POST /api/mvp/events/:id/cancel`. Published → cancelled. |
| 26 | Event delete | `/events/:id/delete` | — | Verified | `DELETE /api/events/:id`. Draft/completed/cancellable only; published deletion requires cancel first. |
| 27 | Guest list | `/events/:id/guests` | `GuestList` | Verified | `GET /api/guests/`, `POST /`, `PUT /:id`, `DELETE /:id`. 50-guest cap, unique normalized email per event, duplicate returns existing guest. Invitation URL generation, email templates, delete guest. |
| 28 | Guest view | `/guest-view/:guestId` | `GuestView` | Verified | Guest detail, QR code, fetch-once-and-cache. |
| 29 | Invitations send | `/events/:id/invitations/send` | — | Verified | `POST /api/mvp/events/:eventId/invitations/send`. Fixed email with HTTPS RSVP URL; delivery labels (queued/accepted/delivered/bounced/failed); idempotent send; 20 sends/5 min per user (`emailLimiter`). |
| 30 | RSVP (anonymous read) | `/api/rsvp/resolve` | `JoinEventPage` | None | `POST /api/rsvp/resolve`. Read invitation facts without mutating. |
| 31 | RSVP (bound write) | `/api/rsvp` | `JoinEventPage` | Optional actor | `PUT /api/rsvp/` (`attachOptionalActor`, not `requireAuth`). Per-invitation `requires_account` switch (default false while iPhone-only). |
| 32 | Check-in | `/api/mvp/guests/:id/check-in` | — | Verified | `POST /api/mvp/guests/:id/check-in`. Attendance audit history; no camera/QR/gesture-only. |
| 33 | Check-in correction | `/api/mvp/guests/:id/check-in/correction` | — | Verified | `POST /api/mvp/guests/:id/check-in/correction`. Audit history preserved. |
| 34 | Timeline | `/events/:id/timeline` | — | Verified | `GET /api/timeline/:eventId`, `POST /`, `PUT /:id`, `DELETE /:id`. Bypassed deliberately (`src/lib/timeline.ts:17` explains why). |
| 35 | Polls | `/polls` | — | Verified | `GET /api/polls/`, `POST /`, `GET /:id`, `POST /:id/vote`, `POST /:id/close`. |
| 36 | PartyBoard stickies | `/partyboard/stickies` | — | Verified | `GET /stickies`, `POST /stickies`, `PATCH position`, `PATCH vote`, `POST convert-to-task`, `GET /tasks`, `DELETE /stickies/:id`. Vote-row design, unique `(sticky_id, user_id)` toggle. |
| 37 | Cost split | `/cost-split/:eventId` | — | Verified | `GET /api/cost-split/:eventId`, `POST /`, `PUT /:id`, `DELETE /:id`. Full CRUD, **no UI on either client** — document as unbuilt. |
| 38 | Invite templates | `/invite-templates` | `TemplateManager` | Verified | `GET /api/invite-templates`, `POST /`, `PUT /:id`, `DELETE /:id`. Strict HTML sanitizer (sanitize-html), template CRUD, preview dialogs. |
| 39 | Event templates list | `/templates` | `TemplateManager` | Verified | `GET /api/event-templates`. 5 seed templates (kids birthday, large adult birthday, corporate offsite, intimate wedding, group travel). |
| 40 | Event template detail | `/templates/:id` | — | Verified | `GET /api/event-templates/:id`. Full template payload. |
| 41 | Create event from template | `/templates/:id/create-event` | — | Verified | `POST /api/event-templates/:id/create-event`. Merge logic, JSON Schema validation, transactional instantiation, usage tracking. |
| 42 | Storage upload | `/storage/upload` | — | Verified | `POST /api/storage/upload`. multer memory storage, 5 MB cap, MIME allowlist jpeg/png/webp/gif. |
| 43 | Storage delete | `/storage/:blobName` | — | Verified | `DELETE /api/storage/:blobName`. |
| 44 | Storage URL | `/storage/url/:blobName` | — | Verified | `GET /api/storage/url/:blobName`. |
| 45 | Realtime negotiate | `/realtime/negotiate` | — | Verified | `GET /api/realtime/negotiate`. Web PubSub client URL with 60-minute token; native WebSocket with `json.webpubsub.azure.v1` subprotocol; polling fallback. |

### 5. AI assistant screens (web)

| # | Page | Path | Component | Auth | Purpose |
|---|------|------|-----------|------|---------|
| 46 | AI chat planner | `/ai/chat` | `AIEventAssistant` | Verified | Chat with event planner. Extraction contract mirroring `ExtractedEventData` in `server/lib/event-extraction.ts`; `ChatTurnResult` from `POST /api/ai/chat`. `onComplete` / `onBack` / `initialTemplate` props. 40-message cap, 4000-char message cap. Welcome message "Hi! I'm your AI Event Planner...". Paywall-gated (402, not 403; fails open narrowly on entitlement read failure). |
| 47 | AI event extraction | `/ai/extract-event-details` | `AIEventAssistant` | Verified | `POST /api/ai/extract-event-details`. Extract structured event data from free text. |

### 6. Template form screens (one per template type)

Design a **template selection screen** + **per-template form screens** that pre-fill event data from the chosen seed template and allow overrides before atomic creation.

| # | Page | Component | Purpose |
|---|------|-----------|---------|
| 48 | Template selection | `EventTemplateSelection` | Grid of templates; pick one to pre-fill the create wizard. |
| 49 | Template detail modal | `TemplateDetailsModal` | Preview/details modal for a template. |
| 50 | Kids birthday form | `KidsBirthdayForm` | Pre-filled from `birthday-kids.json` (ages 4-12, 15-30 guests). |
| 51 | Large adult birthday form | `BirthdayForm` | Pre-filled from `birthday-large.json` (40-80 guests). |
| 52 | Corporate offsite form | `ConferenceForm` | Pre-filled from `corporate-offsite.json` (20-50 attendees, 2 days). |
| 53 | Intimate wedding form | `WeddingForm` | Pre-filled from `wedding-intimate.json` (50-100 guests). |
| 54 | Group travel form | `TravelForm` | Pre-filled from `group-travel.json` (8-20 travelers, multi-day). |
| 55 | Workshop form | `WorkshopForm` | Per-template overrides before atomic create. |
| 56 | Block party form | `BlockPartyForm` | Per-template overrides before atomic create. |
| 57 | Festival form | `FestivalForm` | Per-template overrides before atomic create. |
| 58 | Fundraiser form | `FundraiserForm` | Per-template overrides before atomic create. |
| 59 | Hackathon form | `HackathonForm` | Per-template overrides before atomic create. |
| 60 | Product launch form | `ProductLaunchForm` | Per-template overrides before atomic create. |

### 7. Mind-map planning screens (web) — from MIND_MAP_SCREENS_ARCHITECTURE.md

| # | Page | Path | Component | Purpose |
|---|------|------|-----------|---------|
| 61 | Mind map planning hub | `/events/[id]/planning` | `MindMapScreen` | Main planning hub, tree/canvas view, categories (Food, Venue, Music, Decor, Invites...), progress per category. |
| 62 | Node details | `/events/[id]/planning/node/[nodeId]` | `NodeDetailsScreen` | Task details, status, assignee, due date, budget, subtasks, comments, attachments. |
| 63 | Collaborators / team | `/events/[id]/planning/collaborators` | `CollaboratorsScreen` | Team list, role management (Host/Co-planner/Task owner/Viewer), permissions, activity status, invitation management, vendor list. |
| 64 | Vendors | `/events/[id]/planning/vendors` | `VendorsScreen` | Hired vendors, status tracking, quote/payment, messaging, delivery tracking, recommended vendors (AI-powered), marketplace access. |
| 65 | Activity feed | `/events/[id]/planning/activity` | `ActivityFeedScreen` | Chronological timeline, filter by type, real-time updates, reactions, deep links. |

### 8. Vendor portal screens

| # | Page | Path | Component | Purpose |
|---|------|------|-----------|---------|
| 66 | Vendor dashboard | `/vendor/dashboard` | `VendorDashboardScreen` | Overview stats, urgent actions, active events list, message inbox, performance metrics, reviews. |
| 67 | Vendor event view | `/vendor/event/[eventId]` | `VendorEventViewScreen` | Vendor-scoped task details, status updates, checklist, document uploads, host messaging, payment tracking. |

### 9. Mobile-native screens (Expo Router, iOS MVP-1 — 14 native screens + 6 browser surfaces)

**Signed-out stack:**
| # | Screen | Route | Purpose |
|---|--------|-------|---------|
| 68 | Session resolver | `SYS-01` | Resolves session state before protected content renders. |
| 69 | Signed-out root | `AUTH-01` | Signed-out root; authentication screens push within this stack. |
| 70 | Welcome | `(onboarding)/welcome` | Onboarding welcome screen. |
| 71 | Profile | `(onboarding)/profile` | Onboarding profile screen. |
| 72 | Interests | `(onboarding)/interests` | Onboarding interests screen. |
| 73 | Location | `(onboarding)/location` | Onboarding location screen. |
| 74 | Payment | `(onboarding)/payment` | Onboarding payment screen. |
| 75 | Permissions | `(onboarding)/permissions` | Onboarding permissions screen. |
| 76 | Role | `(onboarding)/role` | Onboarding role selection screen. |

**Signed-in tabs:**
| # | Screen | Route | Purpose |
|---|--------|-------|---------|
| 77 | Events tab root | `(tabs)/index` → `EVT-01` | Owned private events and event creation. |
| 78 | Account tab root | `(tabs)/...` → `SET-01` | Account facts, legal links, support, sign-out, deletion. |

**Event stack:** `EVT-01 -> EVT-02 or EVT-03 -> GST-01 -> GST-02 or INV-01`

| # | Screen | Route | Purpose |
|---|--------|-------|---------|
| 79 | Event details | `events/[id]/index` | Event details view. |
| 80 | Event create assistant | `events/create/assistant.tsx` | AI-assisted event creation. |
| 81 | Event create basics | `events/create/basics.tsx` | Basic event fields. |
| 82 | Event create guests | `events/create/guests.tsx` | Guest list during creation. |
| 83 | Event create timeline | `events/create/timeline.tsx` | Timeline during creation. |
| 84 | Event create review | `events/create/review.tsx` | Review before publish. |
| 85 | Event create index | `events/create/index.tsx` | Create wizard entry. |
| 86 | Event template details | `events/create/template-details.tsx` | Template selection during creation. |
| 87 | Event drafts | `events/drafts.tsx` | Draft events. |
| 88 | Event guests | `events/[id]/guests.tsx` | Guest management. |
| 89 | Event activities | `events/[id]/activities.tsx` | Activities/planning. |
| 90 | Event invites send | `events/[id]/invites/send.tsx` | Send invitations. |
| 91 | Event invites create | `events/[id]/invites/create.tsx` | Create invitation. |
| 92 | Event invites templates | `events/[id]/invites/templates.tsx` | Invite templates. |
| 93 | Guest list | `GST-01` | Guest list screen. |
| 94 | Check-in | `GST-02` | Check-in screen. |
| 95 | Send invitations | `INV-01` | Send invitations screen. |

**Account / deletion:**
| # | Screen | Route | Purpose |
|---|--------|-------|---------|
| 96 | Account | `SET-01` | Account facts, legal, support, sign-out, deletion. |
| 97 | Deletion | `ACC-01` | Deletion impact + reauthenticate. |

**Browser surfaces (6):**
| # | Surface | Purpose |
|---|---------|---------|
| 98 | Browser account action 1 | Account actions reachable from browser. |
| 99 | Browser account action 2 | Account actions reachable from browser. |
| 100 | Browser RSVP | Anonymous RSVP from invitation link. |
| 101 | Browser legal | Terms/privacy/support in browser. |
| 102 | Browser support | Support page in browser. |
| 103 | Browser legal 2 | Additional legal surface. |

**Reusable overlays (3):**
| # | Overlay | Purpose |
|---|---------|---------|
| 104 | `OVL-01` | Dirty-form warning. |
| 105 | `OVL-02` | Destructive confirmation. |
| 106 | `OVL-03` | Invitation confirmation. |

**Not in iOS MVP-1 (do not build):** PartyCrew, Games, Explore, guest, notification, or profile tab.

### 10. Other surfaces (server-only / schema-only — design UI only if prioritized; mark as Absent)

- `timeline` — backend route exists, bypassed deliberately.
- `event-templates` list only — server-only.
- `connections` — no web consumer.
- `cost-split` — full CRUD, **no UI on either client**.
- `vendor marketplace` — `Vendor` and `VendorTask` models exist but have **no API routes**; UI says marketplace unbuilt.
- `games` — screens in `_deferred/`, route `/events/:id/games` does not exist.
- `media` — no `/api/media` route.
- `timeline`, `event-templates` (list only), `connections`, `cost-split` (CRUD, no UI), `vendor marketplace` (Vendor and VendorTask models exist but have **no API routes**; UI says marketplace unbuilt), `games` (screens in `_deferred/`, route `/events/:id/games` does not exist), `media` (no `/api/media` route).

---

## User flows to satisfy (from docs/mobile-ios-launch/04-user-flow-catalog.md)

**FL-01 Account Lifecycle:** signup → consent → browser verification → sign-in → session validated before host data → password recovery → sign-out. Branches: duplicate signup safe recovery, weak password preserves fields, verification resend identical for unknown/verified, invalid/expired/reused tokens disclose no account state, offline launch doesn't treat unvalidated stored token as authorized, VoiceOver/Voice Control operable.

**FL-02 Event Lifecycle:** create draft → publish → edit → complete/cancel → delete. Branches: missing title/invalid timezone/invalid date/end-before-start rejected without data loss; dirty back uses overlay; retry after lost response no duplicate; draft reopens after termination; publish failure leaves draft; concurrent edit detects stale revision; public/capacity>50 rejected; published deletion requires cancel; completion job bounded retry.

**FL-03 Guests and Invitations:** up to 50 unique guests; fixed invitation to selected records only; one event-and-guest-scoped browser RSVP token per recipient. Branches: 51st guest rejected transactionally; duplicate normalized email returns existing; removal revokes RSVP token; unselected guests can't receive send; double tap no duplicate; partial provider failure identifies failed recipients.

**FL-04 Browser RSVP:** anonymous, read-only open doesn't consume/mutate; repeat response idempotent; later response replaces prior; malformed/expired/revoked/removed-guest/cancelled/deleted tokens share privacy-safe unavailable response; token for one guest can't read/mutate another; refresh/back/dropped response no duplicate.

**FL-05 Attendance and Check-In:** one accepted guest checked in once with actor+timestamp; correction changes state without erasing audit; repeated check-in returns original timestamp; no camera/QR/drag/gesture-only.

**FL-06 Account Deletion:** impact review → overlay → reauthenticate → confirm → revoke all sessions → data disposition. Branches: cancel before final confirmation; wrong credentials retain impact review; repeated command idempotent; worker failure keeps access revoked; published events cancel access links before erasure; 365-day audit retains no direct identifier.

---

## What the LLM must produce (deliverables)

1. **Architecture overview** — folder structure, routing strategy (React Router for web, Expo Router for mobile), state management (Zustand + TanStack Query), API client (`src/lib/api-client.ts` contract), auth flow (two localStorage keys, hydration invariant), realtime integration (WebSocket negotiate + fallback polling).
2. **Theme/design system implementation plan** — Tailwind config with canonical primary color, typography scale, motion tokens, shadcn/ui component overrides, dark-mode strategy, `prefers-reduced-motion` guard.
3. **Page/screen inventory** — every route listed above with: path, component name, auth requirement (public / optional / required / verified-only), HTTP methods it calls, request/response shapes, loading/error/empty states, mobile/web variant.
4. **Landing page spec** — hero, CTA intent mapping (`create_event` / `explore` / `auth`), feature sections, footer links, mobile navigation alternative to `hidden md:flex`.
5. **Onboarding spec** — gate sequence after first login, consent version storage, age assertion, username picker, redirect to dashboard.
6. **AI chat spec** — message model, extraction contract, paywall gate (402 handling), retry bounds, 40-message/4000-char caps, welcome message, template pre-selection on complete.
7. **Event templates spec** — template picker grid, template card, details modal, quick-create modal, merge logic UI, override form, integration into Create Event wizard (Template Picker first).
8. **Template forms spec** — one form per template type (birthday, wedding, corporate, travel, festival, conference, fundraiser, hackathon, workshop, block party, product launch), pre-filled from seed template JSON, overrides before atomic create.
9. **Mind-map planning spec** — canvas/tree view, node card, status badge, collaborator card, vendor card, activity item, real-time presence, vendor portal flows.
10. **Guest/invitation/RSVP spec** — guest list with 50-cap enforcement, invitation send with delivery labels, anonymous browser RSVP page (`/join/:token`), check-in + correction overlay.
11. **TypeScript contract definitions** — interfaces mirroring `EventTemplate`, `ExtractedEventData`, `ChatTurnResult`, guest/invitation/RSVP shapes; shared with `packages/core` where applicable.
12. **Open risks and caveats** — SupABASE removed (do not use), two API generations, two localStorage keys, `build.target esnext`, 424 lint warnings, `cost-split` no UI, vendor marketplace unbuilt, games route missing, timeline bypassed.

---

## Format requirements

- Output as a structured design document (markdown), not code to run.
- Use exact file paths, route paths, API endpoints, and symbol names from the codebase (verified above).
- Where the codebase is ambiguous, state the ambiguity and propose the boring/safe option rather than guessing.
- Mark each capability with its state: Shipped / Server-only / Schema-only / Absent (per ROADMAP.md reading rule).
- Do not propose Supabase auth, Realtime, or Storage — the backend is Django + PostgreSQL + Azure Blob + Web PubSub. If a Supabase local container is still desired as a sidecar, note it as optional and separate.
- Prefer boring, maintainable choices; delete weightless code; refuse needless abstractions.

---

## Appendix: Code-Level Context Not Captured in Documentation

These are verified from source (`src/`, `apps/mobile/app/`, `packages/core/`) and exist in code but were not in any doc. Any frontend design must honor them exactly.

### Auth service contract (`src/lib/auth.ts`)

`authService` exposes: `signIn(email, password)`, `signUp(email, password, name, consent)`, `signUpWithInvitation(email, password, name, consent, inviteToken)`, `resendVerification(email)`, `resetPassword(email)`, `signOut()`, `getCurrentUser()`, `getAccessToken()`, `verifyEmail(email, token)`, `handleAuthError()`, `initializeAuthStateListener()`.

- **`signIn`** on 403 `EMAIL_NOT_VERIFIED` returns `{ success: false, needsEmailVerification: true }` — distinct from a 401 wrong-password failure. The client must offer resend, not password reset.
- **`signUp`** writes both storage keys only when the server issues a token (confirmed address via invite). Otherwise `awaitingVerification: true` and nothing is stored.
- **`signUpWithInvitation`** is the **only** signup path that establishes a session immediately (the invitation token was mailed to the address). Writes **both** keys. Without this the app renders a signed-out session.
- **`signOut`** ignores logout errors and calls `clearAuth()` anyway (both keys removed).
- `AuthApiError` carries `status` + `code` so callers can distinguish `EMAIL_NOT_VERIFIED` from generic failures.

### Auth hook (`src/hooks/use-auth.ts`)

- `useAuth()`, `useUser()`, `useRequireAuth()`.
- `reconcileSessionState()`: Zustand state must match localStorage. Hydration happens only when **both** token and cached user are present; writing one without the other yields a session the app renders as signed out.
- MSAL / Entra External ID is **inert**: `isMsalConfigured` is false unless three `VITE_ENTRA_*` build args are set. `msalGetToken()` has zero call sites. The API performs no JWKS/issuer/audience validation, so it cannot verify an Entra RS256 token. Do not design frontend auth around Entra.

### API client (`src/lib/api-client.ts`)

Thin adapter over `packages/core/src/http/transport.ts`. Five helpers: `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`. Each returns `{ data, error }` where `error` carries `status`, `code`, `message`. `apiDelete` **does** take a body (fixed — the web previously could not call three routes that require one).
- `getApiBaseUrl()` / `apiUrl(path)` read `VITE_API_URL` lazily; empty → same-origin relative path proxied by Vite to Django 8001.
- 401 handling: compares rejected token vs stored token before wiping; a 401 from an anonymous endpoint must not sign the user out.
- `redirectToLogin` clears both localStorage keys and navigates — web-specific, injected as transport `onUnauthorized`.

### API base (`src/lib/apiBase.ts`)

`rawApiUrl()` reads `VITE_API_URL` lazily. In dev (`import.meta.env.DEV`) always returns `''` (Vite proxy). `getApiBaseUrl()` and `apiUrl(path)` exported. `getEmailApiUrl()` → `/api/send-email`.

### Auth storage (`src/lib/auth-storage.ts`)

Keys: `partyhause_auth_token`, `partyhause_auth_user`. Exports `getStoredToken`, `setStoredToken`, `getStoredUser`, `setStoredUser`, `clearAuth`, `clearAuthToken`, `clearAuthUser`. `StoredUser` interface: `{ id, email, name?, avatar_url?, role?, user_metadata?: { name?, role? } }`. Valid roles: `user`, `creator`, `vendor`.

### Zustand store (`src/store/usePartyStore.ts`)

`User`: `{ id, email, name?, avatar_url?, role?, user_metadata?: { name?, role? } }`.
`Event`: `{ id, host_id, name, description?, date? (legacy), start_date, end_date, event_type: 'single_day'|'multi_day', location?, max_guests?, is_public, status?: 'draft'|'published'|'active'|'completed'|'cancelled'|'archived', invite_image_url?, template_type?, template_data?, timeline_blocks?, spotify_playlist_url?, created_at, updated_at }`. `status` optional because older cached rows lack it; server always sends it via `serialiseEvent`.
`Guest`: `{ id, event_id, name, email?, phone?, status? ('pending'|'confirmed'|'checked_in'|'no_show'), rsvp_status? ('pending'|'accepted'|'declined'|'maybe'|'confirmed'), checked_in?, plus_ones, special_requirements?, checked_in_at?, created_at, updated_at }`.
`PartyState`: `user, isAuthenticated, sessionValidated, isLoading, events, currentEvent, guests, loadedEventIds (Set<string>), fetchingEventId, setUser, setEvents, setCurrentEvent, setGuests, addGuest, removeGuest, updateGuest, setLoading, logout`.

### Routing architecture (`src/App.tsx`, `src/routes.ts`)

**Dual routing — a known defect.** React Router owns 8 paths; a `currentPage` string state machine behind `path="*"` owns the rest. The state type ends in `| string`, so the literal set is not enforced.
- React Router routes: `/` (landing/AuthScreen), `/auth`, `/auth/verify-email`, `/auth/reset-password`, `/join/:token` (JoinShell), `/join/*`, `/*` (AuthenticatedShell → page switch).
- `AuthenticatedShell` uses TanStack Query (`staleTime: 30s`, `retry: 1` on queries, `retry: 0` on mutations), `HardenedErrorBoundary`, `PWAInstallBanner`.
- `JoinShell` is a separate router mounted at `/join/*` — renders `JoinEventPage` for anonymous RSVP, outside auth.
- Four handled page keys have **no setter**: `logout`, `guest-view-*`, `role-selection`, `games`. Six vendor keys removed 2026-09-07.
- `ProtectedRoute` wraps authenticated children with `useRequireAuth()` + `OnboardingGate`. The gate sits here (not per page) because React Router and the `currentPage` switch both reach pages; a gate in only one is walked around by the other.

### Onboarding gate (`src/components/onboarding/OnboardingGate.tsx`, `use-onboarding.ts`)

- Gate reads `show_picker` (server-computed boolean from four columns) from `GET /api/users/me/onboarding`. Never re-implements server policy client-side.
- TanStack Query with **infinite stale time**; invalidated only on claim or skip — one fetch per session, not per page navigation.
- Fail-open: if the status request fails, children render. Never a blank screen during retry.
- `UsernamePicker`: sanitizes typing (`/[^A-Za-z0-9_]/g`, max length), debounces availability lookup 400ms, shows server's own refusal message. Button color `coral-700 #C02A16` (not `--primary`); focus ring `coral-600 #EA361A`. Skip allowed only when `skippable` is true.

### Legal (`src/lib/legal.ts`)

`CURRENT_TERMS_VERSION = '2026-09-06'`, `CURRENT_PRIVACY_VERSION = '2026-09-06'`, `MINIMUM_ACCOUNT_AGE = 18`. `LEGAL_URLS`: privacy/terms/support on `https://partyhause.uk/` (the `.com` zone was deleted 2026-09-24). `SignupConsent`: `{ ageEligible: true, termsVersion, privacyVersion }`.

### Page shell (`src/components/layout/PageShell.tsx`)

`PageShell` — bg-background page, sticky bg-card header, centered main, max-width map (`sm`/`md`/`lg`/`xl`). `UserMenu` — bell/settings/avatar header cluster. `useBackToDashboard()` — role-aware back navigation.

### Pages (`src/pages/`)

`Dashboard.tsx` — creator studio vs attendee; upcoming events, total guests, quick-create, event cards. `SettingsPage.tsx` — account facts, avatar upload (5 MB, MIME allowlist jpeg/png/webp/gif), username, email, legal, support, sign-out, `DeleteAccountCard`. `ExplorePage.tsx`, `SocialFeedPage.tsx`, `ProfilePage.tsx` (`/users/:id`), `NotificationsPage.tsx`, `PrivacySettingsPage.tsx`, `VerifyEmailPage.tsx`, `ResetPasswordPage.tsx` (writes both token + user on success).

### Components (`src/components/`)

`AuthScreen.tsx` (34.7KB) — landing + auth modes, intents `create_event`/`join_event`/`explore_features`, CTA mapping. `TemplateManager.tsx` — strict HTML sanitizer (sanitize-html, not regex), template CRUD, preview dialogs. `GuestList.tsx` — invitation URL generation (`/event/:eventId/guest/:guestId`), email templates, delete guest. `GuestView.tsx` — guest detail, QR code, fetch-once-and-cache. `RoleSelection.tsx` — role picker (user/creator/vendor), vendor role marked "not built yet". `JoinEventPage.tsx` — anonymous RSVP, `accepted`/`maybe`/`declined` choices, revision-based concurrency, `invitedEmailHint` masked. `PWAInstallBanner.tsx`, `BrandMark`, `PastelCard`, `HardenedErrorBoundary`, `Loading`, `RoleGuard`.

### Mobile (`apps/mobile/app/`) — Expo Router, file-based

Signed-out stack: `(onboarding)/` with `welcome`, `profile`, `interests`, `location`, `payment`, `permissions`, `role`. Signed-in tabs: `(tabs)/` with `index` (dashboard), `partycrew`. Events: `events/create/` (`assistant`, `basics`, `guests`, `timeline`, `review`, `index`), `events/[id]/` (`guests`, `activities`, `index`, `invites/` (`send`, `create`, `templates`)), `events/drafts.tsx`. `join/[token].tsx`. `feed/[postId]/comments.tsx`. `profile/[id].tsx`. `settings/` (`profile`, `index`). No PartyCrew/Games/Explore/guest/notification/profile tab in iOS MVP-1.

### Template forms (`src/components/templates/`)

`TemplateFormRouter`, `AIEventAssistant` (chat + extraction, 40-message/4000-char caps, welcome message), `EventTemplateSelection`, plus per-template forms: `TravelForm`, `WeddingForm`, `WorkshopForm`, `BlockPartyForm`, `ConferenceForm`, `FestivalForm`, `FundraiserForm`, `HackathonForm`, `KidsBirthdayForm`, `ProductLaunchForm`, `BirthdayForm`.

### Other libs

`src/lib/email-tracking.ts` (30KB) — `sendEmailWithTracking`, `emailTemplates`. `src/lib/image-utils.ts` — `uploadImage`, `validateImageFile` (5 MB cap, MIME allowlist). `src/lib/timeline.ts` — timeline bypass rationale. `src/mcp/monitor.ts` — `recordApiCall`. `src/tokens/mobile-aligned.css`, `src/styles/pastel-system.css`, `src/styles/pastel-icons.css`. `src/services/ai/GameRecommendationService.ts`.

### Tests (ground truth for contract shapes)

`src/test/` — `auth.test.ts`, `web-transport-consolidation.test.ts`, `mvp-api-client.test.ts`, `partyboard-contract.test.ts`, `event-dto.test.ts`, `invited-signup-postgres.integration.test.ts`, `auth-session-roundtrip.test.tsx`, `email-verification-gate.test.ts`, `auth-revocation.test.ts`, `landing-page.test.tsx`, `bundle-chunk-graph.test.ts`, `universal-links.test.ts`, `eas-build-config.test.ts`. Integration suites gated on `DATABASE_URL`.

### Shared client (`packages/core/src/http/adapters.ts`)

`STORAGE_KEYS = { token: 'partyhause_auth_token', user: 'partyhause_auth_user' }` — shared so web and mobile agree on session location. `ApiClientConfig`: `{ baseUrl, storage, telemetry?, onUnauthorized?, timeoutMs? }`. `createMemoryStorage()` for tests/SSR. Consumed by mobile only; web uses `src/lib/api-client.ts`. Any API contract change is a two-site change.

---

End of prompt.