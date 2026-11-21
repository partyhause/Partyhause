/**
 * Domain types shared by web and mobile.
 *
 * These mirror the shapes the Express API actually returns, verified against
 * server/routes/*.ts rather than assumed. Where a route selects a subset of
 * columns, the type reflects that subset instead of the full Prisma model.
 */

// Local scope for the interfaces below that reference these. The re-export
// beneath makes them part of this module's public surface; an import is what
// makes them resolvable inside this file.
import type { AuthUser, OwnUserProfile } from './contracts';

// ---------------------------------------------------------------------------
// The contract types.
//
// Re-exported, not redeclared. Each of these used to be a hand-written
// interface here AND a second one in src/, and the copies disagreed: Poll
// named fields the server has never sent, Notification read `read_at` where
// the wire says `read`, UserProfileDetail marked a nullable field
// non-nullable, and PartyEvent required two fields no GET returns.
//
// They are now inferred from the zod schemas in ./contracts, which are
// transcribed from the routes and the database CHECK constraints. There is
// one definition, so there is nothing left to drift.
//
// `export type` is load-bearing: TypeScript erases it, so importing a type
// from this module pulls no zod into a client bundle. Only the server imports
// '@partyhause/core/contracts', where the schemas actually live.
// ---------------------------------------------------------------------------
export type {
  // identity
  AuthUser,
  CurrentUser,
  OwnUserProfile,
  UserProfileDetail,
  UserProfileUpdate,
  OnboardingState,
  UsernameAvailability,
  UsernameLimits,
  UsernameRejectionCode,
  // events
  EventType,
  EventPrivacy,
  EventStatus,
  EventCapabilities,
  EventRelationship,
  PublicEvent,
  HostEvent,
  SerialisedEvent,
  EventStats as EventStatsContract,
  // guests
  RsvpStatus,
  GuestRole,
  EmailStatus,
  Guest,
  GuestCreate,
  GuestPatch,
  // social
  Poll,
  PollOption,
  Notification,
  NotificationActor,
  TimelineBlock,
  TimelineBlockType,
  // conversational planner
  ChatMessage,
  ChatTurnRequest,
  ChatTurnResult,
  ChatTurnResponse,
  ExtractedEventData,
  EventTemplateId,
  // billing and entitlement
  SubscriptionPlan,
  SubscriptionStatus,
  SubscriptionSource,
  EntitlementView,
  // onboarding research
  AutonomyLevel,
  OrganizerType,
  EventsPerYear,
  TypicalGuestCount,
  OnboardingAnswers,
  OnboardingResponse,
} from './contracts';

export type { PaywallReason } from './paywall-copy';
export { CARD_TRIAL_DAYS } from './paywall-copy';

/**
 * The event shape every list and detail route returns.
 *
 * An alias rather than a rename: `PartyEvent` has 19 call sites and the point
 * of this change is to correct the shape, not to churn every import. The name
 * on the contract side is `SerialisedEvent`, which is what
 * server/lib/event-dto.ts calls it.
 *
 * Fields that were previously declared here and are NOT on it, because the
 * DTO allowlist never sent them: `is_public`, `updated_at`, `max_guests`,
 * `invite_image_url`, `spotify_playlist_url`, `timeline_blocks`. Reading any
 * of those is now a compile error rather than a silent `undefined`.
 */
export type { SerialisedEvent as PartyEvent } from './contracts';

export type UserRole = 'user' | 'creator' | 'vendor';

/** POST /api/accounts/login and POST /api/accounts/signup. */
export interface AuthSession {
  user: AuthUser;
  token: string;
}

/**
 * POST /api/accounts/signup.
 *
 * Note the absence of a token. Signup creates the account and sends a
 * confirmation link; it does not establish a session. The route used to return
 * one immediately, which let an address nobody controlled reach every
 * authenticated endpoint for seven days.
 */
export interface SignUpResult {
  user: AuthUser & { email_verified: boolean };
  /** Absent on an invited signup: there is no confirmation link to deliver. */
  verificationDelivery?: 'accepted' | 'unavailable';
  message: string;
  /**
   * Present only when a valid invitation token was supplied for this exact
   * address. The server verified the address on the strength of that token and
   * returned a session, so the caller is signed in rather than waiting on a
   * confirmation email. Check this, not `verificationDelivery`, to decide
   * between routing into the app and showing "check your email".
   */
  token?: string;
  /** The invitation the signup was made against, when there was one. */
  invitation?: { eventId: string; guestId: string };
}


export interface CrewMember {
  id: string;
  user_id: string;
  name?: string | null;
  email?: string;
  avatar_url?: string | null;
  is_crewing?: boolean;
}

/** The answer from `PUT /api/users/me/username`. */
export interface UsernameClaimResult {
  profile: OwnUserProfile;
  /** True when the submitted handle already matched, so nothing was written. */
  unchanged: boolean;
}

export type FeedContentType =
  | 'update'
  | 'photo'
  | 'video'
  | 'poll'
  | 'event_announcement'
  | 'tip'
  | 'recap';

/** The creator summary embedded in every feed post. */
export interface FeedPostCreator {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_verified: boolean;
}

/**
 * A row from GET /api/feed/crew.
 *
 * `feed_score` is computed per request by the ranking pass, not stored, so it
 * is not stable across calls. `poll_options` is a JSON column whose shape
 * depends on `content_type`; it stays `unknown` so callers are forced to
 * narrow it rather than assume.
 */
export interface FeedPost {
  id: string;
  creator: FeedPostCreator;
  content_type: FeedContentType;
  title: string | null;
  body: string | null;
  media_urls: string[];
  event_id: string | null;
  poll_options: unknown;
  poll_ends_at: string | null;

  likes_count: number;
  comments_count: number;
  shares_count: number;
  views_count: number;

  viewer_has_liked: boolean;
  viewer_has_commented: boolean;
  viewer_has_shared: boolean;

  published_at: string;
  created_at: string;
  feed_score: number;
}

/**
 * GET /api/feed/crew is cursor-paginated, not offset-paginated.
 * `next_cursor` is null on the final page.
 */
export interface CrewFeedPage {
  posts: FeedPost[];
  next_cursor: string | null;
  has_more: boolean;
}

/** Rows from GET /api/users/suggested, which carry a human-readable `reason`. */
export interface SuggestedUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_verified: boolean;
  account_type: string;
  events_hosted: number;
  reason: string;
  mutual_crew_count: number;
}

export interface CrewCreator {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_verified: boolean;
  is_mutual: boolean;
  followed_at: string;
}

/**
 * Rows from GET /api/partycrew/members.
 * `mutual_crew_count` is only populated when the request sets
 * `include_mutual_count=true`; otherwise the key is absent entirely.
 */
export interface CrewMemberRow extends CrewCreator {
  mutual_crew_count?: number;
}

/**
 * Rows from GET /api/partycrew/crewing-with, which selects two profile columns
 * that /members does not.
 */
export interface CrewCreatorRow extends CrewCreator {
  account_type: string;
  events_hosted: number;
}

/** POST /api/storage/upload. */
export interface UploadedBlob {
  blobName: string;
  url: string;
}
