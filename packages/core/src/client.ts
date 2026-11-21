/**
 * The shared API client factory.
 *
 * One instance per app. Web and mobile differ only in the adapters they pass:
 *
 *   web    createApiClient({ baseUrl, storage: createWebStorage(),
 *                            telemetry: recordApiCall,
 *                            onUnauthorized: redirectToLogin })
 *   mobile createApiClient({ baseUrl,
 *                            storage: createSecureStoreStorage(SecureStore,
 *                              { legacyStorage: AsyncStorage }),
 *                            onUnauthorized: rejectSession })
 */

import type { ApiClientConfig } from './http/adapters';
import { createTransport } from './http/transport';
import type { Transport, ApiResponse, RequestOptions } from './http/transport';
import { createAuthResource } from './resources/auth';
import type { AuthResource } from './resources/auth';
import { createAccountResource } from './resources/account';
import type { AccountResource } from './resources/account';
import { createRsvpResource } from './resources/rsvp';
import type { RsvpResource } from './resources/rsvp';
import { createMvpInvitationsResource } from './resources/invitations';
import type { MvpInvitationsResource } from './resources/invitations';
import {
  createEventsResource, createGuestsResource, createTimelineResource,
  createPollsResource, createPartyCrewResource, createUsersResource, createFeedResource,
  createNotificationsResource, createStorageResource, createEmailResource,
  createEmailLogsResource, createAiResource, createBillingResource,
  createOnboardingResource,
} from './resources';
import type {
  EventsResource, GuestsResource, TimelineResource, PollsResource,
  PartyCrewResource, UsersResource, FeedResource, NotificationsResource, StorageResource, EmailResource,
  EmailLogsResource, AiResource, BillingResource, OnboardingResource,
} from './resources';

export interface ApiClient {
  auth: AuthResource;
  /**
   * Account summary, legal versions, and permanent deletion.
   *
   * This was written and then never reachable: `createAccountResource` existed
   * with a full deletion flow while this interface had no `account` member and
   * the factory below never called it, so no client could delete an account.
   * App Store guideline 5.1.1(v) requires in-app deletion of any app that
   * creates accounts, which made the omission a submission blocker rather than
   * a missing convenience.
   */
  account: AccountResource;
  /**
   * Anonymous RSVP, reached from an invitation link.
   *
   * Shared so the mobile deep-link screen and the web /join page cannot drift
   * apart on the compare-and-swap contract, which is the exact failure mode
   * two separate clients produce.
   */
  rsvp: RsvpResource;
  /**
   * Host-side invitation sending, and the only thing that mints an RSVP token.
   *
   * This is the same omission the `account` note above describes, repeated.
   * `createMvpInvitationsResource` has existed with a complete send flow since
   * the MVP surface was written, wired into `createMvpApiClient` in ./mvp.ts,
   * whose only caller is a test. This interface had no `invitations` member and
   * the factory below never called it, so no application could reach it.
   *
   * The consequence was worse than a missing convenience. Sending is what
   * writes a `GuestInvitation` row, and that row is what a `/join/:token` link
   * resolves against. With no reachable sender, no token could exist, the
   * `/join/:token` page was unreachable in practice, and both clients fell back
   * to `/api/send-email`, which mails a link to a route that does not exist.
   *
   * Recorded as defect 2 in docs/ROADMAP.md.
   */
  invitations: MvpInvitationsResource;
  events: EventsResource;
  guests: GuestsResource;
  timeline: TimelineResource;
  polls: PollsResource;
  partycrew: PartyCrewResource;
    users: UsersResource;
  /**
   * The conversational event planner.
   *
   * Absent from this client until the planner was brought to mobile. It is the
   * feature a paid tier gates, so it had to exist on both platforms before a
   * paywall could sit in front of it.
   */
  ai: AiResource;
  /**
   * Entitlement and the trial. Both clients read `can_use_ai`; neither
   * re-derives it, because the failure modes are giving the product away and
   * locking out somebody who has paid.
   */
  billing: BillingResource;
  /** The five-screen funnel. The server decides which screen comes next. */
  onboarding: OnboardingResource;
    feed: FeedResource;
  notifications: NotificationsResource;
  storage: StorageResource;
  email: EmailResource;
  emailLogs: EmailLogsResource;
  /**
   * Escape hatch for endpoints with no typed resource yet.
   * Prefer adding a resource module over reaching for this.
   */
  request<T = unknown>(path: string, options: RequestOptions): Promise<ApiResponse<T>>;
  baseUrl: string;
}

/**
 * Construct a client bound to one platform.
 *
 * @param config Base URL plus platform adapters.
 * @returns Typed namespaces over the shared transport.
 * @throws Error if `baseUrl` is empty or `timeoutMs` is not positive.
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  const transport: Transport = createTransport(config);
  return {
    auth: createAuthResource(transport),
    account: createAccountResource(transport),
    rsvp: createRsvpResource(transport),
    invitations: createMvpInvitationsResource(transport),
    events: createEventsResource(transport),
    guests: createGuestsResource(transport),
    timeline: createTimelineResource(transport),
    polls: createPollsResource(transport),
    partycrew: createPartyCrewResource(transport),
      users: createUsersResource(transport),
      ai: createAiResource(transport),
      billing: createBillingResource(transport),
      onboarding: createOnboardingResource(transport),
      feed: createFeedResource(transport),
    notifications: createNotificationsResource(transport),
    storage: createStorageResource(transport),
    email: createEmailResource(transport),
    emailLogs: createEmailLogsResource(transport),
    request: transport.request,
    baseUrl: transport.baseUrl,
  };
}
