# Live play: architecture and build plan

Status: proposed, not built. Written 2026-09-14 against `HEAD`.

Every claim about the current schema and routes was verified by reading the files named. Nothing here is asserted from the prior documentation, which was wrong about this feature in a specific and instructive way.

Product framing and monetization are in `docs/project/GTM_2026_09.md` section 9. Sequencing against everything else being built is in `docs/ROADMAP.md`, which is the authoritative development document and wins over this one on ordering. This document is the engineering plan for the feature itself.

**Prerequisite.** `docs/ROADMAP.md` section 2 records four defects in the invite-to-RSVP-to-check-in loop, two of which mean no client can currently mint an RSVP token or produce a working invitation link. Path A in section 3 below depends on that token. None of this work starts before those defects are closed.

---

## 1. Why the first attempt could never have worked

The story in the repository is that games were built and deleted. That is not what the evidence says. What the evidence says is that **games were never buildable against this schema**, and the deletion was a symptom.

Three independent facts, none of them documented anywhere before now:

| Fact | Evidence | Consequence |
|---|---|---|
| `ActivityParticipant.user_id` is a required FK to `User` | `prisma/schema.prisma:441-451`, unique on `(activity_id, user_id)` | A guest cannot participate in an activity |
| `PollVote.user_id` is a required FK to `User` | `prisma/schema.prisma`, `poll_votes` | A guest cannot vote in a poll |
| `GET /api/realtime/negotiate` is behind `requireAuth`, and the token carries only `userId` with no group | `server/routes/realtime.ts:44`, `:66-69` | A guest cannot hold a realtime connection at all |

And `Guest.user_id` is `String?`, nullable, `ON DELETE SET NULL` (`prisma/schema.prisma`). In practice it is null for almost every guest, because the entire RSVP flow is designed to work without an account (`server/routes/rsvp.ts`).

Put together: **every interactive surface in this product is gated on having an account, and guests do not have accounts.** The fifty people at the party, who are the entire point of a party game, were structurally excluded from playing one.

That is why the old marketing could claim 30 games and the codebase could deliver zero. The gap was not effort. It was an identity model that had no concept of a person who is at the party but not a customer.

**Nothing in section 3 onward is worth starting until this is fixed.** It is layer zero.

### The legacy models are not a foundation

`Game` (`prisma/schema.prisma:125`) and `GameSession` (`:145`) exist and have no routes. `GameSession` is explicitly commented "Legacy game sessions table" and stores `scores Json @default("{}")` with **no participant table at all**. There is no per-player row, therefore no way to attribute a score, prevent a double submission, or show a player their own answer.

`Activity` (`:413`) and `ActivityParticipant` (`:439`) are a genuinely better foundation. `Activity` already carries `type` constrained to `('poll','trivia','scavenger','vote','quiz')`, a `status` lifecycle of `('draft','active','paused','completed')`, and `config` and `results` as JSON. `ActivityParticipant` carries `score`, `completed`, `responses` and a correct unique constraint. Only the identity column is wrong.

**Recommendation: drop `Game` and `GameSession` in the same migration that lands layer zero.** They carry no data worth keeping, they have no routes, and `Event.active_game_id` (the `EventActiveGame` relation at `:138`) has to go with them. Leaving two parallel models in the schema is how the next person to read this builds on the wrong one.

---

## 2. The shape of the thing

Five layers. Each is independently testable and the first three are the entire hard part.

```
L4  CONTENT      game definitions as versioned data + AI generation
L3  MODERATION   filter, host kill switch, rate limits
L2  REALTIME     Web PubSub groups, anonymous player tokens
L1  ROUND ENGINE one state machine, games expressed as data
L0  IDENTITY     EventPlayer: a person at the party, with or without an account
```

---

## 3. Layer 0: player identity

A player is a person at an event. They may be a registered user, a guest on the list, or a plus-one who walked in with someone. All three must be able to play, and only the first has a `User` row.

```prisma
model EventPlayer {
  id         String  @id @default(dbgenerated("gen_random_uuid()"))
  event_id   String
  session_id String?

  /// Set when the player arrived via their invitation link.
  guest_id   String?
  /// Set when the player is signed in. Both may be null: a plus-one who
  /// joined with the room code is a real player with no prior record.
  user_id    String?

  /// What other players see. Chosen at join, moderated, not unique.
  display_name String

  /// SHA-256 of the bearer credential this player holds. The plaintext is
  /// returned once at join and never stored, matching the GuestInvitation
  /// pattern at prisma/schema.prisma:1318.
  token_hash String @unique

  joined_at    DateTime  @default(now())
  last_seen_at DateTime  @default(now())
  /// Host kick, or moderation. Revoked players cannot rejoin on this token.
  revoked_at   DateTime?

  event   Event  @relation(fields: [event_id], references: [id], onDelete: Cascade)
  guest   Guest? @relation(fields: [guest_id], references: [id], onDelete: SetNull)
  user    User?  @relation(fields: [user_id], references: [id], onDelete: SetNull)

  @@index([event_id, last_seen_at])
  @@unique([event_id, guest_id])
  @@map("event_players")
}
```

### Two join paths, and why the credentials differ

**Path A, the invitation link.** The guest already holds a 43-character RSVP token delivered by email (`server/lib/rsvp.ts:7`, pattern `/^[A-Za-z0-9_-]{43}$/`). They arrive, the token resolves to a `Guest`, and an `EventPlayer` is minted linked to that guest.

**Path B, the room code.** A four to six character code the host displays on a screen or reads aloud. Anyone in the room joins. This is not a weakness, it is a requirement: partners, plus-ones and the friend who was invited by text all need to play, and demanding they be on the guest list to join a trivia round is the account wall in a different coat.

**The play credential must not be the RSVP token.** The RSVP token is a long-lived bearer credential that can change an RSVP and read event details. A room code path cannot mint one, and a play token should never be capable of mutating an RSVP. So `EventPlayer.token_hash` is a separate, session-scoped, short-lived credential. Path A consumes the RSVP token once to establish identity and then issues a play token; it never reuses it.

### Bounds on the room code

A short code is guessable by construction, so every one of these is required, not optional.

| Bound | Value |
|---|---|
| Code lifetime | Live only while the session is open, rotated on demand by the host |
| Join rate limit | Per IP, per code. A code under brute force locks and the host is told |
| Max players per session | 200. Above the 50-guest event cap deliberately, for plus-ones |
| Host lock | The host can close joining at any point, and the session auto-locks after the first round |
| Code alphabet | Unambiguous only. No `0`, `O`, `1`, `I`, `l`. It gets read aloud in a loud room |

The code grants exactly one capability: join this session and submit answers. It reveals no guest list, no contact details, and no event record beyond the session's own display name.

---

## 4. Layer 1: the round engine

This is the decision that determines whether "more games over time" costs engineering effort per game or not.

**Build one state machine. Express games as data.**

Almost every party game that works on a phone decomposes into a sequence of one primitive: pose a prompt, collect responses, score them, reveal. What varies is three enumerations.

```ts
/** How a player answers. */
type InputMode = 'choice' | 'text' | 'number' | 'ranking';

/** How responses become points. */
type ScoringMode =
  | 'exact'      // matches the correct answer
  | 'closest'    // numeric proximity, ranked
  | 'plurality'  // most-voted wins, no correct answer exists
  | 'judge'      // the host picks
  | 'none';      // played for the reveal, not the score

/** When players see the outcome. */
type RevealMode = 'instant' | 'after_all' | 'host_controlled';
```

Against that, the catalogue collapses:

| Game | Input | Scoring | Reveal | Needs a pre-phase |
|---|---|---|---|---|
| Trivia about the host | `choice` | `exact` | `instant` | no |
| Guess Who Said It | `choice` | `exact` | `instant` | yes, `text` collection |
| Two Truths and a Lie | `choice` | `exact` | `after_all` | yes, `text` collection |
| How Well Do You Know Them | `choice` | `exact` | `after_all` | yes, host answers |
| Prediction (what time do speeches start) | `number` | `closest` | `host_controlled` | no |
| Superlatives and Awards | `choice` | `plurality` | `after_all` | no |
| This or That | `choice` | `none` | `instant` | no |
| Song Queue Vote | `choice` | `plurality` | `instant` | no |

Eight games. One engine. Adding a ninth is a JSON definition and a content pass, not a deploy.

### Session state machine

```
lobby ──► round_prompt ──► collecting ──► scoring ──► reveal ──┬──► round_prompt
                                                                └──► finished
                     any state ──► abandoned (TTL) | cancelled (host)
```

### Invariants

Every one is a bound the engine enforces. None is a hope about player behaviour.

| Invariant | Value and reason |
|---|---|
| Collection closes on all-active-responded **or** timeout, whichever is first | 45 s default. Someone joins, plays two rounds, and goes to the bathroom. The round must not block on a player who left. |
| A player is `active` if `last_seen_at` is within 90 s | Otherwise a single departed phone stalls every subsequent round |
| Max rounds per session | 20. Termination bound. |
| Max players per session | 200 |
| One response per player per round | Unique `(round_id, player_id)`. The `PollVote` unique constraint is the precedent. |
| Session TTL | 6 hours from creation, then `abandoned`. Parties end. |
| Scoring is server-side only | A client that computes its own score is a client that reports its own score |
| Correct answers are never sent to clients before `reveal` | Trivially observable in devtools otherwise |

### The join floor

A trivia round with 4 of 40 guests playing is worse than no trivia, because it visibly fails in front of the room. Before the host starts round one, show the join count and make starting a deliberate act below a threshold. This is a product invariant, not a nicety: the failure mode is public embarrassment for the customer at their own party.

---

## 5. Layer 2: realtime

Two changes to existing code, both of which are prerequisites rather than enhancements.

**`sendToAll` must become group-scoped.** `server/lib/pubsub.ts:82` currently sends every message to every connected client on the hub. Today the payloads are `{ eventId }` and clients refetch through authorized endpoints, so it is survivable. Broadcast live game state through it and every connected browser receives every other party's rounds, answers and player names.

One Web PubSub group per session. `sendToGroup(sessionId, envelope)`. The same fix is a prerequisite for the agent harness, so do it once.

**Negotiate must serve anonymous players.** `server/routes/realtime.ts:44` requires auth and `:66` issues a token carrying only `userId`. Add a second path that takes a play token, verifies it against `EventPlayer.token_hash`, and issues a Web PubSub token joined to that session's group and nothing else.

Keep it a separate route from the authenticated one. Weakening `requireAuth` on the existing endpoint to accommodate players is how an anonymous caller ends up with a user-scoped realtime token.

**Polling fallback stays.** `WEBPUBSUB_CONNECTION_STRING` is optional and negotiate already returns 503 when it is unset. The engine must be playable over polling, because a venue with poor connectivity is the normal case, not the edge case. Design the round endpoints to be pollable at 2 s and treat realtime as an optimisation.

---

## 6. Layer 3: moderation

Live play displays player-submitted text to a room of people, projected on a screen, at an event with a named host. This is the highest-risk surface in the product and it needs to be treated that way.

| Control | Requirement |
|---|---|
| Display names | Filtered at join, length-capped, no URLs, no markup |
| Free-text responses | Filtered before they ever reach the reveal |
| Host kill switch | Remove any response and kick any player, taking effect within one round |
| Revocation | A kicked player's `revoked_at` blocks rejoin on that token; a rotated room code blocks the rest |
| Rate limit | Per player per round, plus a session-wide submission ceiling |
| Retention | Responses inherit the event's deletion path. They must be covered by `runRetentionSweep` and by account deletion. |

The account-deletion obligation is not optional: `docs/mobile-ios-launch/` mandates in-app deletion of a user's data, and player responses tied to a `user_id` are that user's data.

---

## 7. Layer 4: content, and the part competitors cannot copy

Generic trivia is a commodity. Kahoot does it better and it is free.

The version that is defensible is trivia **about the guest of honour**, generated from what this product already holds: the event record, the occasion, the host's own answers, and the guest list as the option set for any "who did what" question. Kahoot cannot generate a round about whose birthday it is, because Kahoot does not know.

This is where live play meets the **compere companion** specified in `docs/ROADMAP.md` section 3. Content generation is a batch job shaped like the after-phase: no user waiting, high reversibility. It runs when the host asks for it during planning, not at the party.

The compere and live play are the same during-event system read two ways. The compere reads `TimelineBlock` and announces what is next; live play occupies the gap the compere just identified. `TimelineBlock.guest_visible` already separates what the host knows from what the room may be told, and a game session is the one thing a compere can start rather than merely narrate.

```
Event context + host answers ──► agent run ──► draft rounds
                                                    │
                                          host reviews and edits
                                                    │
                                              published game
```

**The host reviews before publication, always.** Autonomy level `act_autonomously` does not extend to putting unreviewed model output on a screen in front of the customer's family. A wrong fact about someone's late father, generated confidently and projected at their memorial gathering, is the kind of failure that ends a product. The review step is a safety control, not a UX preference.

Content is versioned data, not code:

```prisma
model GameDefinition {
  id        String @id
  slug      String @unique   // 'trivia-host', 'guess-who-said-it'
  version   Int
  /// InputMode, ScoringMode, RevealMode, round templates, bounds.
  spec      Json
  /// Which tier may run it.
  tier      String           // 'free' | 'pro'
  published Boolean @default(false)
  @@unique([slug, version])
}
```

A definition is loaded and validated against a zod schema at session start. An invalid definition fails the session start, loudly, rather than half-running a malformed game in front of a room.

---

## 8. Where it integrates

```
server/lib/play/
  identity.ts    EventPlayer mint, join by RSVP token or room code, revoke
  engine.ts      The session state machine. Pure where possible.
  scoring.ts     Pure. exact | closest | plurality | judge | none.
  definitions.ts Load and validate GameDefinition against a zod spec
  moderation.ts  Name and response filtering, host controls

server/routes/play.ts
  Host, requireAuth:
    POST   /sessions                  create, returns room code
    POST   /sessions/:id/lock
    POST   /sessions/:id/rounds/next
    POST   /sessions/:id/reveal
    DELETE /sessions/:id/players/:pid kick
  Player, play-token:
    POST   /join                      room code or RSVP token -> play token
    GET    /sessions/:id/state        pollable, 2 s
    POST   /sessions/:id/respond

server/routes/realtime.ts   add the anonymous player negotiate path
server/lib/pubsub.ts        sendToAll -> sendToGroup
```

Host mutations go through `executeMvpCommand` (`server/lib/mvp-command.ts:105`) for the same reasons every other write does: replay safety on retry, an audit row, and one transaction boundary. Player responses do **not**: they are high-frequency, low-value, idempotent by their own unique constraint, and routing them through the command log would fill `mvp_commands` with thousands of rows per party for no benefit. The unique `(round_id, player_id)` is the idempotency guarantee that matters there.

---

## 9. iOS

Live play is **web-first and stays out of the approved iOS MVP.** `docs/mobile-ios-launch/01-product-scope.md` lists games as `REMOVED_FROM_IOS_MVP` and declares zero sensitive permissions as a release invariant. Do not reopen that scope to add this. Ship the approved app, pass review on the first attempt, then decide.

This is not a compromise. Guests playing in a mobile browser from a link or a room code is strictly better than guests playing in an app, because there is no install between the room code and the first round. Every successful party game product that requires an install pays for it in join rate, and join rate is the metric this entire feature is judged on.

The host's controls may eventually come to iOS as a later release. The players should never need it.

---

## 10. Build order

Each step is shippable and each depends on the one above.

1. **Migration: drop `Game` and `GameSession`, add `EventPlayer`.** Removes the wrong foundation and lands the right identity primitive. Must also drop `Event.active_game_id`.
2. **`sendToAll` to `sendToGroup`.** Shared prerequisite with the agent harness.
3. **Anonymous negotiate path** plus the play-token middleware.
4. **`scoring.ts` and the engine state machine.** Pure, no I/O, exhaustively testable. The real design work is here and it needs no infrastructure to verify.
5. **One game, end to end: This or That.** `choice`, `none` scoring, `instant` reveal, no pre-phase, no correct answers, no moderation surface beyond display names. It is the smallest possible complete path through all five layers and it proves the join rate, which is the number the whole feature lives or dies on.
6. **Measure join rate before building game two.** If fewer than half the guests at a real party join a one-tap game with no account and no install, the problem is not the catalogue and no additional game fixes it.
7. **Trivia with host-authored content.** Adds `exact` scoring and correct-answer secrecy.
8. **AI-generated trivia content** through the agent harness. This is the first paid-tier game.
9. **Guess Who Said It.** Adds the pre-event text collection phase, which also makes the invitation email a second engagement surface.
10. The rest of the catalogue as content.

---

## 11. Risks, stated plainly

**Party game apps are a graveyard, and the exceptions prove a rule.** Jackbox works because it is a shared-screen living-room purchase with a host device. Kahoot works because classrooms are captive, scheduled, and run by an authority figure. A phone game at a party competes with the party itself, which is the thing everybody actually came for.

The mitigation is design discipline and it must hold: rounds under 90 seconds, launched by the host at a chosen moment, never a browsable "games tab." If a guest has to decide to go looking for it, it has already failed.

**The join rate is the whole feature.** Everything else is downstream. Step 6 exists to find this out for the price of one game rather than eight.

**Content generation can produce a catastrophe.** A confidently wrong or tactless AI-generated fact about a named real person, projected on a wall at their own event. The review gate in section 7 is the control and it cannot be optional at any autonomy level.

**Moderation is a real liability, not a checkbox.** Anonymous text from a room full of drinking adults, displayed on a screen. Assume the worst submission will happen at the worst event and make sure the host can remove it in one tap within one round.

**The 50-guest cap and the 200-player ceiling disagree on purpose.** Plus-ones are real and they will join. Make sure nothing downstream assumes players are a subset of the guest list, because `EventPlayer.guest_id` is nullable for exactly this reason.
