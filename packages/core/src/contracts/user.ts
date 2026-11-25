/**
 * Identity and profile.
 *
 * `User` / `UserProfile` was typed eleven times. Two of those definitions
 * caused concrete defects:
 *
 *   - `src/features/partycrew/types/index.ts:38` types `last_active_at` as a
 *     non-nullable `string`. The server nulls it for a private profile
 *     (`server/routes/users.ts:886-910`) and for anyone who turned
 *     `show_activity_status` off (`:935`). Because the type said it could not
 *     be null, `useUserProfile.ts:69` "defaults" it to `new Date()`, so a user
 *     who deliberately hid their activity is displayed as active right now.
 *     That is a privacy setting the UI silently inverts.
 *   - The same file marks the six `viewer_*` relationship flags REQUIRED. They
 *     are present only when `optionalAuth` resolved a caller, so they are
 *     absent for anonymous viewers.
 *
 * `packages/core`'s loose `UserProfile` (six optional fields, plus a `role`
 * the server has never had a column for) matched no route at all and has been
 * deleted rather than corrected.
 */

import { z } from 'zod';
import {
  clearableText,
  counter,
  identifier,
  isoDateTime,
  nonEmptyText,
  profileAccountType,
  webUrl,
} from './primitives';

/** The identity half, as login and signup return it. */
export const authUser = z.object({
  id: identifier,
  email: z.string(),
  name: z.string().nullable(),
  email_verified: z.boolean(),
});

/**
 * The caller's own profile (`OWN_PROFILE_SELECT`, server/routes/users.ts:32-47).
 *
 * Carries the privacy flags and the onboarding state, neither of which any
 * other viewer sees.
 */
export const ownUserProfile = z.object({
  id: identifier,
  username: z.string(),
  display_name: z.string(),
  bio: z.string().nullable(),
  avatar_url: z.string().nullable(),
  location: z.string().nullable(),
  website_url: z.string().nullable(),

  is_private: z.boolean(),
  show_attending_events: z.boolean(),
  show_partycrew_list: z.boolean(),
  show_activity_status: z.boolean(),

  username_set_at: isoDateTime.nullable(),
  onboarding_skipped_at: isoDateTime.nullable(),
  onboarding_required: z.boolean(),
});

/**
 * Another user's profile (`GET /api/users/:id`, server/routes/users.ts:913-936).
 *
 * The `viewer_*` flags are optional because an anonymous caller gets none of
 * them. `last_active_at` is nullable for the reason in the module header.
 */
export const userProfileDetail = z.object({
  id: identifier,
  username: z.string(),
  display_name: z.string(),
  bio: z.string().nullable(),
  avatar_url: z.string().nullable(),
  cover_photo_url: z.string().nullable(),
  location: z.string().nullable(),
  website_url: z.string().nullable(),

  partycrew_count: counter,
  crewing_count: counter,
  events_hosted: counter,
  haus_score: counter,

  is_verified: z.boolean(),
  is_private: z.boolean(),
  account_type: profileAccountType,

  viewer_is_following: z.boolean().optional(),
  viewer_is_follower: z.boolean().optional(),
  viewer_is_mutual: z.boolean().optional(),
  viewer_has_pending_request: z.boolean().optional(),
  viewer_is_blocked: z.boolean().optional(),
  viewer_has_blocked: z.boolean().optional(),
  mutual_crew_count: counter.optional(),

  created_at: isoDateTime,
  /** Null when the owner hid activity, or when the profile is private. */
  last_active_at: isoDateTime.nullable(),
});

/**
 * The `PUT /api/users/me/profile` body (server/routes/users.ts:73-97).
 *
 * `username` is deliberately absent. A handle is a globally unique identity
 * with a change cooldown and a release hold, so it has its own endpoint and
 * its own schema below. Folding it in here would mean a caller who mistypes
 * the key gets a 200 and no username change.
 */
export const userProfileUpdate = z
  .object({
    display_name: nonEmptyText(80).optional(),
    bio: clearableText(500).optional(),
    location: clearableText(120).optional(),
    website_url: z.union([webUrl, z.literal('')]).optional(),
    is_private: z.boolean().optional(),
    show_attending_events: z.boolean().optional(),
    show_partycrew_list: z.boolean().optional(),
    show_activity_status: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'No updatable fields provided',
  });

/** `GET /api/accounts/me`. */
export const currentUser = z.object({
  id: identifier,
  email: z.string(),
  name: z.string().nullable(),
  created_at: isoDateTime,
  email_verified: z.boolean(),
  profile: ownUserProfile.nullable().optional(),
});

/**
 * Why a candidate username was refused.
 *
 * The authority is `server/lib/username.ts`, which is server-only because it
 * carries the reserved-word list. This mirrors its `UsernameRejectionCode`
 * plus the two codes the route adds for state the pure validator cannot see.
 */
export const usernameRejectionCode = z.enum([
  'USERNAME_REQUIRED',
  'USERNAME_TOO_LONG',
  'USERNAME_TOO_SHORT',
  'USERNAME_INVALID_CHARACTERS',
  'USERNAME_EDGE_UNDERSCORE',
  'USERNAME_REPEATED_UNDERSCORE',
  'USERNAME_RESERVED',
  'USERNAME_SYSTEM_PREFIX',
  'USERNAME_TAKEN',
  'USERNAME_ON_HOLD',
]);

export const usernameAvailability = z.object({
  username: z.string(),
  available: z.boolean(),
  code: usernameRejectionCode.optional(),
  message: z.string().optional(),
});

export const usernameLimits = z.object({
  min_length: z.number().int(),
  max_length: z.number().int(),
  cooldown_days: z.number().int(),
  max_suggestions: z.number().int(),
});

export const onboardingState = z.object({
  username: z.string(),
  display_name: z.string(),
  username_is_generated: z.boolean(),
  has_chosen_username: z.boolean(),
  /** Computed server-side so two clients cannot derive it differently. */
  show_picker: z.boolean(),
  skippable: z.boolean(),
  can_change_at: isoDateTime.nullable(),
  suggestions: z.array(z.string()),
  limits: usernameLimits,
});

/** The `PUT /api/users/me/username` body. */
export const usernameClaim = z.object({ username: z.string() });

export type AuthUser = z.infer<typeof authUser>;
export type OwnUserProfile = z.infer<typeof ownUserProfile>;
export type UserProfileDetail = z.infer<typeof userProfileDetail>;
export type UserProfileUpdate = z.infer<typeof userProfileUpdate>;
export type CurrentUser = z.infer<typeof currentUser>;
export type UsernameRejectionCode = z.infer<typeof usernameRejectionCode>;
export type UsernameAvailability = z.infer<typeof usernameAvailability>;
export type UsernameLimits = z.infer<typeof usernameLimits>;
export type OnboardingState = z.infer<typeof onboardingState>;
export type UsernameClaim = z.infer<typeof usernameClaim>;
