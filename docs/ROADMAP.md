# Roadmap

Written 2026-09-14. Every capability claim below was verified by reading the code, not by trusting
a previous document. Where something is unbuilt it says so, and where something is built but
unreachable it says that instead, because the difference is what decides whether it can be sold.

This document covers three things that turned out to be one thing: what the product does today, the
paid tier being built on top of it, and the onboarding funnel that sells it.

**Reading rule.** Every capability carries a state. They are not interchangeable.

| State | Means |
|---|---|
| **Shipped** | Server route exists, a client calls it, and a user can reach the UI |
| **Server only** | Route exists, no client calls it. Not a feature a user has |
| **Schema only** | Prisma model exists, no route. Not a feature at all |
| **Absent** | Not present in any form |

---

## 1. Where the product actually is

Counting only Shipped:

| Phase | Reachable capabilities |
|---|---|
| Before the event | 10 |
| During the event | 4 |
| After the event | **1** |

That asymmetry is the most important fact in this document. **PartyHause is a planning product.**
"After the event" is attendance counts and an archive button that exists only on mobile. Recaps,
media galleries, cost reconciliation and post-event posts are schema-only or server-only.
`PartycrewPost` has no creation path anywhere in the codebase, so the social feed reads rows that
nothing can write.

Anything that describes the product as a full-lifecycle platform today is describing software that
does not exist.

### Before the event

| Capability | State | Evidence |
|---|---|---|
| AI planning assistant | Shipped, web + mobile | `server/routes/ai.ts:46`; `AIEventAssistant.tsx:159`; `apps/mobile/app/events/create/assistant.tsx:154` |
| Event creation from templates | Shipped | `server/routes/events.ts:159`; 11 web forms, 12 mobile |
| Timeline / run-of-show building | Shipped | `server/routes/timeline.ts:57`; `src/lib/timeline.ts:105` |
| Guest list building | Shipped | `server/routes/guests.ts:111`; `GuestList.tsx:78` |
| Invitation email with delivery tracking | Shipped | `server/index.ts:272`; `src/lib/email-tracking.ts:141` |
| Invite design and customisation | Shipped | `EventCreation.tsx:361`, `:372` |
| Invite image upload | Shipped | `server/routes/storage.ts:98` |
| Polls for group decisions | Shipped, partial | Create and vote reachable; **close** is server only |
| PartyBoard sticky ideation | Shipped, web only | `server/routes/partyboard.ts`; no mobile board |
| Saved invite templates | Shipped, unreachable entry | `/templates` works if typed; no link sets it |
| Cost splitting | **Server only** | Full CRUD at `cost-split.ts`, zero callers on any platform |
| Server template catalogue | **Server only** | `/api/event-templates`, zero callers |
| Shareable join links | **Server only** | `/api/invites`, zero callers |
| Co-host management | **Schema only for writes** | `EventCoHost` drives real authorization everywhere, and no route creates one |
| Vendor management | **Schema only** | `Vendor`, `VendorTask`. `VendorTask` has zero references in any file |

### During the event

| Capability | State | Evidence |
|---|---|---|
| Live headcount and check-in status | Shipped | `events.ts:68`; `EventManagement.tsx:215` |
| Check in from a phone | Shipped, mobile | `app/events/[id]/guests.tsx:142` |
| Manual code check-in | Shipped, web | `QRScanner.tsx:249` |
| Run-of-show display | Shipped, mobile only | `app/events/[id]/activities.tsx:264`. Web can build a schedule and cannot display it afterwards |
| QR camera check-in | **Broken.** See defect 3 | `QRScanner.tsx:85` |
| Realtime updates | **Server only** | Seven broadcast sites in production, zero subscribers |
| Live polls | Shipped, no push | Results update on refetch only |
| Guest-facing live view | **Server only** | `GuestView.tsx` has no reachable entry point |
| Games | **Absent**, and were never buildable. See section 7 | `Game`/`GameSession` have zero server references. The blocker is identity, not effort: `ActivityParticipant.user_id` and `PollVote.user_id` are required FKs to `User`, so a guest cannot play anything |
| Media capture | **Schema only** | `Media` is counted, never written. No `/api/media` |
| Event notifications | **Absent** | All four notification writers are social-graph events |

### After the event

| Capability | State |
|---|---|
| Attendance counts | Shipped, basic. `events.ts:68` |
| Archive an event | Shipped, mobile only |
| Attendance audit trail | **Server only.** `AttendanceAudit` is written and readable through no endpoint |
| Email analytics | **Server only.** `GET /api/email-logs/analytics/event` has zero callers |
| Recaps | **Absent** |
| Media galleries | **Schema only** |
| Cost reconciliation | **Server only** |
| Post-event posts | **Absent.** No creation path for `PartycrewPost` |
| Follow-up messaging | **Absent.** The only sender fires automatically on guest creation |

---

## 2. Four defects that block selling anything

These come before every feature below. Three of them sit inside the invite-to-RSVP-to-check-in
loop, which is the loop any paid tier implies.

**Status: 2 of 4 closed on 2026-09-14.** Defect 1 is fixed server-side, with its client half noted
below. Defect 2 is closed, which also closes defect 4 on mobile. Defect 3 and defect 4 on web remain
open.

**RSVP now requires an account. Confirmed product direction, 2026-09-14.** A guest registers before
responding, and that account is their attendee profile.
`prisma/migrations/20260915000000_rsvp_requires_account` adds `guest_invitations.requires_account`
with `DEFAULT false` and then flips the default to `true`, so every invitation already in an inbox
is grandfathered in one atomic statement and the grandfathered set can never grow. It also makes
`guests(event_id, user_id)` unique, which is what stops one account holding two seats at one event.
Enforced by `resolveBinding` in `server/lib/rsvp.ts`.

`docs/project/GTM_2026_09.md` section 2 was rewritten for this. The previous analysis argued the
invitation loop could only reduce CAC because guests never registered. That is now the opposite of
true: every RSVP is a registration, so the loop becomes the primary acquisition channel, at the cost
of a signup wall between the invitee and the answer the host is waiting for.

**`docs/mobile-ios-launch/01-product-scope.md` still needs reconciling.** It defines actor `R` as a
browser RSVP recipient with no account, which is no longer the contract for any invitation issued
after this change. The approved scope document should say so before submission, because it is the
document App Review decisions are traced to.

### Defect 1: no reachable client can publish an event. FIXED 2026-09-14

`server/routes/events.ts` never destructured `status`, and hardcoded `'draft'` in the create
payload. Mobile sent `status: 'published'` at `app/events/create/review.tsx:131` and it was silently
discarded. **Every event either client created was stuck in draft forever.**

Closed by `server/lib/event-status.ts`, a pure module carrying the vocabulary transcribed from
`events_status_check`. `POST /api/events` now honours a creatable status (`draft` or `published`,
still defaulting to `draft` when absent, which is what the web form sends) and refuses anything else
with a 400.

**A second defect was found on the adjacent path and fixed in the same change.** `PUT
/api/events/:id` destructured `status` and wrote it to the column with no validation, so any string
reached a CHECK constraint and surfaced as a 500 carrying the constraint name through the
`err.message` leak at `server/index.ts:393`. That was unreachable in practice only because no client
sent the field; honouring it on create is precisely what would have made it reachable. Both paths
now validate through the same module.

Both paths also now maintain `published_at` and `cancelled_at` (`prisma/schema.prisma:39-40`), which
this route had never written. The MVP service maintained them and this one did not, so the same
column meant different things depending on which client created the row.

Covered by `src/test/event-status.test.ts`, 23 tests: exhaustive over the vocabulary, plus route
tests for both regressions. Verified to fail against the previous handler.

**Still open, and not part of this fix:** `POST /api/mvp/events/:id/publish` has no non-test caller,
and no client calls `PUT` with a status either. The server can now record a publication; **no user
interface triggers one.** Defect 1 was the blocking half. Wiring a client control is the other half
and belongs with the mobile and web work in item 1 of section 8.

### Defect 2: RSVP tokens cannot be minted. FIXED 2026-09-14 (client wiring)

`GuestInvitation` rows are created only at `server/lib/mvp-invitations.ts:859`, reached through
`POST /api/mvp/events/:eventId/invitations/send`. The server side was always complete. The typed
client, `createMvpInvitationsResource`, was always complete. It was wired into `createMvpApiClient`
in `packages/core/src/mvp.ts`, whose only caller is `src/test/mvp-api-client.test.ts`.

**`createApiClient`, the factory both applications actually use, had no `invitations` member**, and
`packages/core/src/client.ts` never called the resource factory. So nothing an application could
call wrote a `GuestInvitation`, no token existed, and `/join/:token` was built, correct and
unreachable.

This is the second time this precise omission shipped. The `account` member of the same interface
carries a comment describing the first: `createAccountResource` was complete and missing from the
interface, which made in-app deletion impossible and blocked App Store submission. A resource that
exists and is not exposed costs a release.

Closed by adding `invitations` to `ApiClient` and to the factory, and by pointing the mobile send
screen at it. `createMvpIdempotencyKey` moved from `./mvp` to `./http/idempotency`, re-exported from
both entry points, because the shared client now carries a command endpoint.

**This also closes defect 4 for the mobile path.** The MVP sender renders the invitation server-side
and links to `/join/<token>`, so it never constructs the dead `/event/:eventId/guest/:guestId` URL.

Covered by `src/test/invitation-minting.test.ts`, 10 tests, verified to fail against the previous
client.

**Still open:** the web client does not consume `packages/core` at all, so `src/components/GuestList.tsx`
still auto-sends through `/api/send-email` with a dead link on guest creation. Defect 4 is closed on
mobile and open on web. Unifying the two clients is the durable fix and is not part of this change.

**Depends on defect 1.** `assertFuturePublished` (`server/lib/mvp-invitations.ts:253-260`) refuses to
send for anything that is not `published`, so this was unreachable until publishing worked. The
mobile screen now names that case explicitly rather than showing the raw server message.

**Scope trap worth knowing.** `eventWhere` (`server/lib/mvp-invitations.ts:224-233`) matches only
events with `privacy: 'private'`, `is_public: false` and `max_guests: 50`. Those are the column
defaults, so ordinary events qualify, but a host who raises the guest cap makes their event
invisible to the invitation service and gets a 404. That is inherited iOS-MVP scoping, not a new
defect, and it needs a decision before the web client moves across.

### Defect 3: the QR code shown cannot be scanned

The server stores the canonical payload `partyhause://checkin/{eventId}/{guestId}` on the guest row
(`guests.ts:25`). `GuestList.tsx:368` renders a QR encoding an `https://` invitation URL instead.
`parseCheckinPayload` rejects anything containing `://` (`QRScanner.tsx:28`). The displayed code
always yields "Unrecognized QR code".

### Defect 4: every emailed RSVP link is dead

`GuestList.tsx:25` builds `/event/:eventId/guest/:guestId`. No such route exists in `App.tsx`, so
it falls through `path="*"` and renders the dashboard. `apps/mobile/lib/api.ts:117` builds the
identical dead path.

---

## 3. The AI, today and next

### Today

One endpoint has a caller: `POST /api/ai/chat`, the conversational planner. It is stateless, reads
the whole transcript each turn, and returns a reply plus a cumulative extraction.

`POST /api/ai/extract-event-details` exists and has zero callers anywhere.

There is no other model use in the repository. No embeddings, no retrieval, no ranking, no
moderation. The feed's ranking is arithmetic.

**One property matters commercially.** When the model is unconfigured, times out, or returns
something unparseable, `runChatTurn` falls back to a deterministic chrono-node and lexicon
extractor. The response shape is identical and the user cannot tell. `source` is the only signal,
which is why metering counts `source = 'llm'` only: charging for the fallback would bill for an
answer the model never produced.

### Next: the compere companion

The strongest during-event feature available, because the data model for it already exists.

A compere runs the room: announces what is next, covers a gap, introduces a segment, keeps the
schedule honest. Every input that needs is already in `TimelineBlock`:

```
label          what the segment is
start_time     when it should happen
duration       how long it should take
type           activity | meal | speech | performance | break | custom
host_notes     private, host-only
guest_visible  whether guests may see this block at all
```

`guest_visible` is the load-bearing column. It already separates what the host knows from what the
room may be told, so a companion that speaks to guests and a companion that prompts the host are
the same feature reading the same table through different filters.

**What it would do**

| Capability | What it needs that does not exist |
|---|---|
| Prompt the host: "cake in ten minutes, here is the intro" | AI awareness of a live event. The planner is stateless and knows only a transcript |
| Announce transitions to guests | A guest-facing live view. `GuestView.tsx` exists and is unreachable |
| Notice the schedule has slipped and offer a recovery | Nothing monitors elapsed time against `start_time` |
| Fill a lull with something to do | Games are absent; polls exist and could be reused |
| Answer "when is dinner" for guests | Guest-facing surface, plus read access scoped by `guest_visible` |

**What it can reuse**

- `TimelineBlock`, complete, with host and guest separation already modelled.
- Web PubSub, running in production and broadcasting from seven sites with zero subscribers. A
  compere is the first genuine reason to mount `useRealtimeSubscriptions`, which has been written
  and unimported since it was added.
- `Notification`, whose only writers today are social-graph events.

**Two honest caveats.** `timeline-updated` is in the client hook's event union and is broadcast by
no server code, and `partyboard-updated` is broadcast from five sites and is absent from that
union. Both must be fixed before realtime carries anything a user depends on during a live event.

This is the feature that would make "during the event" real. It is also the feature that would
justify describing the product as a companion rather than a planner, and it should not be described
that way until it exists.

---

## 4. Billing and the paid tier

One funnel, one trial. A 7-day no-card trial was designed and cut: the onboarding paywall is hard,
and a free path beside it makes it soft.

| Phase | Scope | State |
|---|---|---|
| 0 | Legal rewrite, App Store Connect record, `REMOVED_FROM_IOS_MVP` reversal | **Blocking, not started** |
| 1 | Entitlement core: `Subscription`, `AiUsage`, `BillingEvent`, `OnboardingResponse`, the projection, `GET /api/billing/entitlement` | **Shipped**, `9fa5b76` |
| 2 | Quota enforcement, metering, funnel state machine, `/api/onboarding` | **Shipped server-side**, `20d301d`. No UI |
| 3 | Stripe: Checkout, Portal, webhooks, the 14-day card trial | Blocked on Phase 0 legal |
| 4 | StoreKit on iOS | Blocked on the App Store Connect record and `ascAppId` |
| 5 | Trial-expiry sweeper, dunning, deletion cleanup | After 3 and 4 |

### Design rules already enforced in code

**Entitlement is computed, never stored.** There is no `is_entitled` column. A stored boolean is a
cache of a time-dependent fact and goes stale silently: a trial ending at 03:00 would keep granting
access until something rewrote the row, and nothing does at 03:00.

**One boolean, computed server-side.** Both clients read `can_use_ai` rather than deriving it from
six fields. Two clients deriving it separately is two chances to derive it differently, and the
failure modes are giving the product away and locking out somebody who has paid.

**The gate answers 402, not 403.** The request is well-formed and the caller is authenticated; what
is missing is payment. A 403 is indistinguishable from an authorization failure and the client
would render the wrong screen.

**It fails open, narrowly.** If entitlement cannot be read, the turn proceeds. A database blip must
not lock a paying customer out of what they pay for. The blast radius is a handful of free turns
during an outage; the opposite default is an outage that arrives at support as a billing dispute.

**Blocking prerequisites.** `public/terms.html:61` is a section headed "No Payments" and
`public/privacy.html:77` describes Apple as providing "purchase-free download records".
`src/test/legal-surfaces.test.ts` pins the version across four files, so this is a coordinated bump
rather than a paragraph edit. `docs/mobile-ios-launch/07-ios-app-store-launch-requirements.md:202`
makes a free app with no payment surface MANDATORY for submission, and `README.md:99` requires a
full re-assessment to reverse that.

---

## 5. The onboarding funnel

Five screens. The paywall is fourth and hard.

```
1  chat           three model turns, the only free value       research: none
2  who_you_are    organizer type, scale                        research: everyone
3  ai_lifecycle   before / during / after                      research: everyone
4  paywall        HARD, only entitlement clears it             ─────────────────
5  autonomy       how much the model may act unasked           research: payers only
```

**Why the wall is fourth.** Screen 3 is the last cheap commitment before money and the screen whose
answers make the wall specific rather than generic. It also keeps the research worth having:
everything before the wall is answered by people who never pay, and those are the only rows that
can explain a refusal. `autonomy_level` sits after the wall because asked of somebody who has just
paid it is product setup rather than a survey.

**The step is derived, not stored.** There is no `current_step` column. It is computed from the
answers that exist, because a stored pointer can disagree with the data behind it and a derivation
cannot.

**Only entitlement clears the wall.** There is no dismiss, which is what makes it hard rather than
a prompt.

**Partial answers are kept.** Every column is nullable and `completed_at` is one-way. A
half-finished response is research, and the people who stop answering are the most interesting
sample there is.

### Screen 1: chat

The three free model turns. No questions. The user describes an event and gets a real answer.

Implemented: web `AIEventAssistant.tsx`, mobile `app/events/create/assistant.tsx`. Neither handles
the 402 yet; both special-case only 429.

### Screen 2: who you are

| Field | Options |
|---|---|
| `organizer_type` | personal, professional, corporate, community |
| `events_per_year` | 1-2, 3-10, 11-50, 50+ |
| `typical_guest_count` | under-20, 20-50, 51-150, over-150 |

No capability is required behind these.

### Screen 3: where AI should help

Every option is marked. **Now** means shipped and reachable today. **Roadmap** means research signal
only, and the paywall must not imply it.

**Before the event**

| Option | State |
|---|---|
| Pick the format and starting template | **Now** |
| Pull date, headcount and budget out of a description | **Now** |
| Settle group decisions | **Now**, manual polls |
| Draft the run of show | Roadmap |
| Write the invitation copy | Roadmap |
| Suggest who to invite | Roadmap |
| Chase people who have not replied | Roadmap |

**During the event**

| Option | State |
|---|---|
| Live headcount and check-in status | **Now** |
| Check people in from a phone | **Now**, mobile |
| Act as compere: announce what is next and cover gaps | Roadmap. Section 3 |
| Tell me when the schedule slips | Roadmap |
| Answer guest questions for me | Roadmap |
| Chase vendors | Roadmap. `Vendor` is schema-only |

**After the event**

| Option | State |
|---|---|
| Who actually turned up | **Now**, basic counts |
| Draft thank-you messages | Roadmap |
| Write the recap | Roadmap |
| Settle who owes what | Roadmap. `/api/cost-split` has zero callers |
| Tell me what to change next time | Roadmap |

### Screen 4: the paywall

Card plus a 14-day trial. Hard.

**It may only quote back Now items.** A wall that says "you want RSVP chasing and recap drafting,
that is Pro" would be describing software that does not exist, and the first refund request would
be correct. Quote the planning capabilities, which are real, and treat the rest as research.

Blocked on Phase 3 for the card form. Until then the wall can render with real entitlement state
behind it and no way to pay, which is worth building because it produces the drop-off measurement
that decides whether the wall belongs at position four at all.

### Screen 5: autonomy

| Field | Options |
|---|---|
| `autonomy_level` | suggest, draft, act_with_approval, act_autonomously |

`autonomy_level` is the single most commercially useful answer in the funnel. It decides whether
this is a copilot or an agent, and those are different products at different prices.

`agentic_wants`, grounded:

| Option | State |
|---|---|
| Send the invitation the moment I add someone | **Already happens**, automatically, `GuestList.tsx:139` |
| Chase non-responders on a schedule | Roadmap |
| Rebuild the schedule when one thing moves | Roadmap |
| Keep the guest list deduplicated | Roadmap. A unique index already refuses duplicates |
| Draft the recap without asking | Roadmap |

---

## 6. Live play: the guest surface

Full engineering plan in `docs/LIVE_PLAY.md`. Product framing and monetization in
`docs/project/GTM_2026_09.md` section 9. Reinstated by decision on 2026-09-14 after being cut.

### Why it was never buildable, which is not the same as never built

The repository records that games were deleted. The schema records something more useful.

| Fact | Evidence | Consequence |
|---|---|---|
| `ActivityParticipant.user_id` is a required FK to `User` | `prisma/schema.prisma:441-451` | A guest cannot join an activity |
| `PollVote.user_id` is a required FK to `User` | `poll_votes` | A guest cannot vote in a poll |
| `/api/realtime/negotiate` requires auth; the token carries `userId` and no group | `server/routes/realtime.ts:44`, `:66-69` | A guest cannot hold a realtime connection |
| `Guest.user_id` is nullable and null for nearly every guest | `prisma/schema.prisma` | The people at the party are not users |

**Every interactive surface in this product is account-gated, and guests do not have accounts.** The
fifty people the game is for were structurally excluded from playing it. That is why the old
marketing could claim thirty games while the codebase delivered zero, and it is why deleting the
screens changed nothing: the screens were not the problem.

`Game` and `GameSession` are not a foundation either. `GameSession.scores` is opaque JSON with no
participant table, so there is no per-player row, therefore no way to attribute a score or refuse a
second submission. Both should be dropped, along with the `EventActiveGame` relation at
`prisma/schema.prisma:138`, in the same migration that adds the replacement.

`Activity` and `ActivityParticipant` (`:413`, `:439`) are the right foundation. Only the identity
column is wrong.

### Why it is worth doing now, having been cut

Two arguments, neither of which is the one the 2025 documents made.

**It is the only guest-facing surface.** Everything reachable today is host-facing. A guest's entire
experience is one email and one RSVP page, which is why the invitation loop decays rather than
compounds. Live play is the one surface where every guest uses the product on their own phone.

**It is what the compere has to offer.** Section 3 specifies a companion that announces transitions
and notices a lull. A companion that identifies a lull and can do nothing about it is a narrator.
Live play is the thing it starts.

### State

| Capability | State |
|---|---|
| `EventPlayer` identity for a person without an account | **Absent.** Layer zero, blocks everything below |
| Round engine: one state machine, games as data | **Absent** |
| Web PubSub group scoping | **Absent.** `pubsub.ts:82` is `sendToAll`, shared blocker with the compere |
| Anonymous player negotiate path | **Absent** |
| Moderation, host kill switch | **Absent** |
| Game definitions as versioned content | **Absent** |

### The two decisions that carry the feature

**One engine, games as data.** Trivia, Guess Who Said It, Two Truths, Prediction, Superlatives, This
or That and Song Queue all decompose into one primitive crossed with three enumerations:
`InputMode`, `ScoringMode`, `RevealMode`. Eight games at launch, and the ninth is a definition
rather than a deploy. Without this, catalogue growth costs an engineer per entry, which is how the
2025 plan arrived at a number it could not build.

**Bespoke content is the paid tier, and the guest never pays.** Generic trivia is a commodity that
Kahoot does better for free. Trivia about the guest of honour, generated from the event record and
the host's own answers, is not copyable. Guests play free, with no account, always: charging the
guest destroys the acquisition surface to collect nothing.

### Not in the iOS MVP

`docs/mobile-ios-launch/01-product-scope.md` lists games as `REMOVED_FROM_IOS_MVP`. Do not reopen
that scope. Guests play in a mobile browser from a room code, which is strictly better than an
install, because there is no store between the code and the first round. Join rate is the metric
this feature is judged on and an install is the largest tax available on it.

Note this is a different judgement from section 4's Phase 0, which **does** require reversing
`REMOVED_FROM_IOS_MVP` for payments. Payments must be in the app because Apple requires it.
Games must not be, because nothing requires it.

---

## 7. The venue decorator

Product framing in `docs/project/GTM_2026_09.md` section 8. **Absent** in every layer. Listed here so
the decision to defer it is recorded rather than forgotten.

An agent that takes a venue, an event type, a budget and a theme, and returns a decoration plan: a
zoned layout, a shopping list with real purchasable items at current prices, a setup sequence, and a
render. Not a mood board, a plan that can be executed.

It fits this product specifically because the context already exists on the `Event` record (theme,
budget, location, guest count, date), because it is the bridge to the schema-only `Vendor` model,
and because the autonomy ladder in section 5 maps onto it exactly: `suggest` gives directions,
`draft` gives the plan, `act_with_approval` fills a cart, `act_autonomously` books an installer.

**Deferred, and the reason is sequencing rather than doubt.** It depends on media upload, which is
schema-only (`Media` is counted and never written, and there is no `/api/media`). It is a
photo-permission feature, and `docs/mobile-ios-launch/02-information-architecture.md` declares zero
sensitive permissions a release invariant. And it needs affiliate sourcing, which is an ongoing
operational commitment rather than an integration.

**The cheap test comes first.** Template-driven decoration plans by event type and budget tier,
sourced from a curated catalogue of two to three hundred items, with no vision model and no image
generation. If a hand-built plan with a real shopping list does not convert, the generated version
will not either, and it will cost ten times more to find that out.

---

## 8. Order of work

1. **The four loop defects.** Publishing, RSVP token minting, the QR payload, the dead invitation
   link. Taking money for a loop that does not close is the worst option on this list, and defect 1
   is a one-line cause.
2. **Phase 0 legal.** Blocks Stripe. Long lead time, and not engineering work.
3. **Onboarding screens 2, 3 and 5**, plus the wall rendering without a card form. Produces the
   drop-off data that validates the wall's position before it is load-bearing.
4. **Phase 3 Stripe.** The wall starts earning.
5. **Cost splitting reaches a client.** Full CRUD has existed at `cost-split.ts` with zero callers
   for months. It is the largest gap between built and reachable in the product, and it is the
   feature the group-travel segment actually converts on.
6. **Realtime gets its first subscriber.** Group-scope `pubsub.ts:82` off `sendToAll`, mount
   `useRealtimeSubscriptions`, and fix the two event-union mismatches in section 3. Shared
   prerequisite for both items below, and a latent data leak until it is done.
7. **The compere companion.** The first real during-event feature, and the first genuine consumer
   of the realtime infrastructure already running in production.
8. **Live play, section 6.** Sequenced deliberately after the compere, because live play is the
   content a compere runs and the identity layer is easier to justify once something needs it.
   Stop after one game and measure join rate before building a second.
9. **Phase 4 StoreKit**, whenever Apple's prerequisites clear.
10. **The venue decorator**, section 7, and only its non-generated v0. Requires media upload, which
    is schema-only today.

Items 1 and 2 are independent and can run in parallel. Nothing else should start before 1.

Items 6 through 8 are one coherent arc: realtime becomes real, the compere uses it, live play gives
the compere something to run. Splitting them across quarters means paying the realtime
prerequisite cost without collecting anything for it.

### What is deliberately not on this list

**A games catalogue.** Section 6 ships one game and then measures. Any plan that names a number of
games before the first join-rate measurement exists is the 2025 plan again.

**The vendor marketplace.** `Vendor` and `VendorTask` are schema-only and `VendorTask` has zero
references in any file. A two-sided marketplace is not a feature, and the decorator in section 7 is
the only thing that would generate demand for one.

**Media galleries and recaps.** Both are real gaps in the after-event phase, which section 1 shows
is the weakest of the three. Neither is on this list because both depend on media upload, and
media upload is the prerequisite nobody has scheduled. That is a gap in this roadmap, not an
omission: when after-event work is next prioritised, `/api/media` is where it starts.
