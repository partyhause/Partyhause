/**
 * @partyhause/core
 *
 * The shared API client. It is written against a storage adapter rather than
 * against `localStorage` directly, because React Native has no `localStorage`
 * and any client that assumes one is web-only by construction.
 *
 * Note that the web app does not consume this package today; it runs a second
 * client at src/lib/api-client.ts. Treat any API contract change as a
 * two-site change until they are unified.
 */

export { paywallCopy } from './paywall-copy';
export { createApiClient } from './client';
export type { ApiClient } from './client';

export { createTransport } from './http/transport';
export type {
  Transport, ApiResponse, ApiError, HttpMethod, RequestOptions,
} from './http/transport';

export { STORAGE_KEYS, createMemoryStorage } from './http/adapters';
export type {
  TokenStorage, Telemetry, ApiCallRecord, UnauthorizedHandler, ApiClientConfig,
} from './http/adapters';

export {
  createWebStorage,
  createAsyncStorage,
  createSecureStoreStorage,
  SECURE_STORE_MIGRATION_KEY,
} from './http/storage-adapters';
export type {
  AsyncStorageLike,
  SecureStoreLike,
  SecureStoreStorageOptions,
  WebStorageLike,
} from './http/storage-adapters';

export type { AuthResource } from './resources/auth';
export { createAccountResource } from './resources/account';
export type {
  AccountDeletion,
  AccountDeletionStatus,
  AccountLegalSummary,
  AccountResource,
} from './resources/account';
export { createRsvpResource } from './resources/rsvp';
export type {
  RsvpChoice,
  RsvpInvitation,
  RsvpResource,
} from './resources/rsvp';
// Host-side invitation sending. This is the only call that mints an RSVP
// token, so it is what makes the `/join/:token` page reachable at all.
export { createMvpInvitationsResource } from './resources/invitations';
export type {
  MvpInvitationCandidate,
  MvpInvitationDeliveryStatus,
  MvpInvitationPreview,
  MvpInvitationSendItem,
  MvpInvitationSendResult,
  MvpInvitationsPage,
  MvpInvitationsResource,
} from './resources/invitations';
// Required on every `/api/mvp` write. Exported here, not only from ./mvp,
// because the shared client now carries a command endpoint.
export { createMvpIdempotencyKey } from './http/idempotency';
// Value exports, not just types: both clients mirror these bounds to trim a
// transcript before sending rather than discover the limit as a 400. The web
// client had them hardcoded at AIEventAssistant.tsx:33-34.
export { MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGE_CHARS, trimTranscript } from './resources';

export type {
  EventsResource, GuestsResource, TimelineResource, PollsResource,
  PartyCrewResource, UsersResource, FeedResource, NotificationsResource,
  StorageResource, EmailResource, EmailLogsResource, AiResource,
  BillingResource, TrialStartResponse,
  OnboardingResource, OnboardingFunnelState, OnboardingFlowView, OnboardingStepView,
  EventStats, EventWithStats,
  GuestCreateInput, GuestUpdateInput, EmailLog, EmailLogInput,
  UserProfileUpdate,
  TimelineBlockInput,
  CrewStatus, CrewConnection, CrewRequest, CrewToggleResult, CrewMembersPage, CrewingWithPage, CrewRequestsPage,
  PostComment,
  PostCommentAuthor,
  PostCommentPage,
} from './resources';

export * from './types';
export * from './legal';
export * from './app-install';
