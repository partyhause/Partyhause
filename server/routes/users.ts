// Express route: /api/users
// User profile and suggested creators endpoints
// Replaces Vercel serverless functions api/users/[id].ts and api/users/suggested.ts

import { Router } from 'express';
import type { Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { requireAuth, optionalAuth } from '../middleware/auth';
import type { AuthenticatedRequest } from '../middleware/auth';
import {
  MAX_USERNAME_SUGGESTIONS,
  USERNAME_CHANGE_COOLDOWN_DAYS,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  buildUsernameCandidates,
  checkUsernameCooldown,
  isGeneratedUsername,
  releasedUsernameHoldCutoff,
  usernameChangeAvailableAt,
  validateUsername,
} from '../lib/username';
import {
  validateBirthDate,
  validateInterests,
  validateMediaUrl,
} from '../lib/profile-validation';

const router = Router();

// ---------------------------------------------------------------------------
// The profile shape the owner's own routes return. One constant so GET, PUT
// and the username claim cannot drift into returning three different objects
// for the same resource, which is how a client ends up with a field that is
// present on one screen and undefined on the next.
// ---------------------------------------------------------------------------
const OWN_PROFILE_SELECT = {
  id: true,
  username: true,
  display_name: true,
  bio: true,
  avatar_url: true,
  cover_photo_url: true,
  location: true,
  website_url: true,
  birth_date: true,
  interests: true,
  marketing_opt_in: true,
  is_private: true,
  show_attending_events: true,
  show_partycrew_list: true,
  show_activity_status: true,
  username_set_at: true,
  onboarding_skipped_at: true,
  onboarding_required: true,
} as const;

// Availability lookups answer "does this handle exist" for an arbitrary
// string, which is an enumeration oracle even behind requireAuth. 60 per 5
// minutes is well above a human typing into a debounced field and far below a
// useful scrape of a namespace. Keyed by user id so one account cannot buy
// more budget with more IP addresses; ipKeyGenerator collapses an IPv6 /64
// for the unauthenticated fallback, which cannot normally be reached here but
// is the same defect that was fixed on the AI and email limiters.
const usernameLookupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) =>
    (req as AuthenticatedRequest).user?.id ?? ipKeyGenerator(req.ip ?? '') ?? 'unknown',
  message: { error: 'Too many username checks. Try again in a few minutes.' },
});

// Claims mutate a globally unique namespace and write a history row. The
// 30-day cooldown already bounds them to roughly one per month per account;
// this bounds the failed attempts that never reach the cooldown check.
const usernameClaimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) =>
    (req as AuthenticatedRequest).user?.id ?? ipKeyGenerator(req.ip ?? '') ?? 'unknown',
  message: { error: 'Too many username attempts. Try again later.' },
});

/** True when Prisma reports a unique conflict on the username namespace. */
function isUsernameConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object' || (error as { code?: unknown }).code !== 'P2002') {
    return false;
  }
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  // A P2002 with no target cannot be attributed; the only unique columns on
  // this table are the two username forms, so treat it as the conflict it
  // almost certainly is rather than reporting a 500.
  if (target === undefined || target === null) return true;
  const fields = Array.isArray(target) ? target : [target];
  return fields.some((field) => String(field).toLowerCase().includes('username'));
}

/**
 * Handles from the candidate list that nobody holds and no hold covers.
 *
 * Two round trips at most, both indexed: `username_normalized` is uniquely
 * indexed on user_profiles, and `(username_normalized, released_at)` covers
 * the hold scan. Issued concurrently because neither depends on the other.
 *
 * @param seed Primary source for the stem, normally the display name.
 * @param fallbackSeed Used when the primary yields nothing, normally the
 *                     email local part.
 * @param viewerProfileId Excluded from the hold check, so a user is always
 *                        offered a handle they released themselves.
 * @returns Up to {@link MAX_USERNAME_SUGGESTIONS} free handles, in the
 *          deterministic order the generator produced them. Empty when the
 *          seeds yield no legal stem.
 *
 * Complexity: O(k log n) for a fixed k of at most
 * {@link MAX_USERNAME_SUGGESTIONS}. Blocking I/O.
 */
async function availableSuggestions(
  seed: unknown,
  fallbackSeed: unknown,
  viewerProfileId: string,
): Promise<string[]> {
  const candidates = buildUsernameCandidates(seed, fallbackSeed);
  if (candidates.length === 0) return [];

  const normalized = candidates.map((candidate) => candidate.toLowerCase());

  const [claimed, held] = await Promise.all([
    prisma.userProfile.findMany({
      where: { username_normalized: { in: normalized } },
      select: { username_normalized: true },
    }),
    prisma.usernameHistory.findMany({
      where: {
        username_normalized: { in: normalized },
        released_at: { gt: releasedUsernameHoldCutoff() },
        profile_id: { not: viewerProfileId },
      },
      select: { username_normalized: true },
    }),
  ]);

  const taken = new Set<string>();
  for (const row of claimed) taken.add(row.username_normalized);
  for (const row of held) taken.add(row.username_normalized);

  return candidates.filter((candidate) => !taken.has(candidate.toLowerCase()));
}

// ---------------------------------------------------------------------------
// GET /api/users/me/profile - the caller's own profile including privacy
// flags (which GET /:id withholds from other viewers).
// NOTE: Must be defined before /:id to avoid route shadowing.
// ---------------------------------------------------------------------------
router.get('/me/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { id: req.user!.id },
      select: OWN_PROFILE_SELECT,
    });
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json({ profile });
  } catch (err) {
    console.error('[Users] me/profile error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/me/profile - update the caller's own profile and privacy
// settings. Only whitelisted fields are writable; unknown keys are ignored.
// ---------------------------------------------------------------------------
router.put('/me/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data: Record<string, unknown> = {};

    // Privacy flags: strict booleans only.
    for (const flag of [
      'is_private',
      'show_attending_events',
      'show_partycrew_list',
      'show_activity_status',
    ] as const) {
      if (flag in body) {
        if (typeof body[flag] !== 'boolean') {
          return res.status(400).json({ error: `${flag} must be a boolean` });
        }
        data[flag] = body[flag];
      }
    }

    // Basic profile text fields: bounded strings, empty string clears.
    const textFields: Array<{ key: 'display_name' | 'bio' | 'location' | 'website_url'; max: number; required?: boolean }> = [
      { key: 'display_name', max: 80, required: true },
      { key: 'bio', max: 500 },
      { key: 'location', max: 120 },
      { key: 'website_url', max: 200 },
    ];
    for (const { key, max, required } of textFields) {
      if (key in body) {
        const value = body[key];
        if (typeof value !== 'string' || value.length > max) {
          return res.status(400).json({ error: `${key} must be a string of at most ${max} characters` });
        }
        const trimmed = value.trim();
        if (required && trimmed.length === 0) {
          return res.status(400).json({ error: `${key} cannot be empty` });
        }
        // website_url is rendered as a clickable link (window.open on the
        // profile page): anything other than http(s) — javascript:, data:,
        // vbscript: — is a stored-XSS payload, not a website.
        if (key === 'website_url' && trimmed.length > 0 && !/^https?:\/\//i.test(trimmed)) {
          return res.status(400).json({ error: 'website_url must start with http:// or https://' });
        }
        data[key] = trimmed.length === 0 ? null : trimmed;
      }
    }

    // Profile photo and header. Only URLs the journey just received from
    // POST /api/storage/upload ever reach this legitimately, but the endpoint
    // is authenticated-not-authorised, so anything client-supplied is
    // validated the same way. Empty string clears, mirroring website_url.
    for (const key of ['avatar_url', 'cover_photo_url'] as const) {
      if (key in body) {
        const problem = validateMediaUrl(body[key]);
        if (problem) {
          return res.status(400).json({ error: `${key} ${problem}` });
        }
        const trimmed = (body[key] as string).trim();
        data[key] = trimmed.length === 0 ? null : trimmed;
      }
    }

    // B2C identity fields for the about-you step. Birth date is a real
    // calendar date, never the future; interests are a closed taxonomy so
    // recommendations never fragment; the marketing flag is a strict boolean
    // like the privacy flags above, defaulting to opted out.
    if ('birth_date' in body) {
      const problem = validateBirthDate(body.birth_date);
      if (problem) {
        return res.status(400).json({ error: `birth_date ${problem}` });
      }
      data.birth_date = body.birth_date === '' ? null : new Date(`${body.birth_date}T00:00:00Z`);
    }
    if ('interests' in body) {
      const problem = validateInterests(body.interests);
      if (problem) {
        return res.status(400).json({ error: `interests ${problem}` });
      }
      data.interests = body.interests as string[];
    }
    if ('marketing_opt_in' in body) {
      if (typeof body.marketing_opt_in !== 'boolean') {
        return res.status(400).json({ error: 'marketing_opt_in must be a boolean' });
      }
      data.marketing_opt_in = body.marketing_opt_in;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const profile = await prisma.userProfile.upsert({
      where: { id: userId },
      update: data,
      create: {
        id: userId,
        ...data,
      },
      select: OWN_PROFILE_SELECT,
    });

    res.json({ profile });
  } catch (err) {
    console.error('[Users] update me/profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/me/role - record which personality the caller registered as.
//
// Separate from PUT /me/profile on purpose: profile is free-text identity,
// role is a closed enum the journey gates on, and a bulk patch that accepted
// both would let a profile edit silently change the gate. The CHECK
// constraint users_account_role_check is the authority; this membership test
// only turns a 500 into a 400 with a sentence.
// ---------------------------------------------------------------------------
const ACCOUNT_ROLES = ['creator', 'vendor', 'attendee'] as const;

router.put('/me/role', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const role = (req.body as Record<string, unknown> | null)?.account_role;

    if (typeof role !== 'string' || !(ACCOUNT_ROLES as readonly string[]).includes(role)) {
      return res.status(400).json({ error: 'account_role must be one of creator, vendor, attendee' });
    }

    const row = await prisma.user.update({
      where: { id: userId },
      data: { account_role: role },
      select: { account_role: true },
    });

    res.json({ account_role: row.account_role });
  } catch (err) {
    console.error('[Users] update me/role error:', err);
    res.status(500).json({ error: 'Failed to save your role' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/users/username-available?username=<candidate>
//
// Every literal path in this router must be registered before `/:id`, or
// Express binds it as an id and the endpoint answers 404 for its whole life.
// That is not hypothetical: GET /api/email-logs/analytics/event shipped that
// way and stayed broken until 2026-09-07.
//
// Authenticated on purpose. An anonymous availability check tells the whole
// internet which handles exist, which is a directory of the user base.
// ---------------------------------------------------------------------------
router.get(
  '/username-available',
  requireAuth,
  usernameLookupLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const requested = (req.query as { username?: unknown }).username;

      const check = validateUsername(requested);
      if (!check.ok) {
        return res.json({
          username: typeof requested === 'string' ? requested : '',
          available: false,
          code: check.code,
          message: check.message,
        });
      }

      const [claimed, held] = await Promise.all([
        prisma.userProfile.findUnique({
          where: { username_normalized: check.normalized },
          select: { id: true },
        }),
        prisma.usernameHistory.findFirst({
          where: {
            username_normalized: check.normalized,
            released_at: { gt: releasedUsernameHoldCutoff() },
            profile_id: { not: userId },
          },
          select: { id: true },
        }),
      ]);

      // A normalized match against the caller's own row is a casing edit, not
      // a collision. Reporting it as taken would tell a user their own handle
      // belongs to somebody else.
      if (claimed && claimed.id !== userId) {
        return res.json({
          username: check.username,
          available: false,
          code: 'USERNAME_TAKEN',
          message: 'That username is taken.',
        });
      }

      if (held) {
        return res.json({
          username: check.username,
          available: false,
          code: 'USERNAME_ON_HOLD',
          message: 'That username was recently in use and is not available yet.',
        });
      }

      return res.json({ username: check.username, available: true });
    } catch (err) {
      console.error('[Users] username-available error:', err);
      res.status(500).json({ error: 'Failed to check that username' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/users/me/onboarding - everything the picker needs in one call.
//
// `show_picker` is computed here rather than left to each client to derive
// from four fields. Two clients deriving the same boolean from the same four
// fields is two chances to derive it differently, and the failure mode is a
// user who is either nagged forever or never asked at all.
// ---------------------------------------------------------------------------
router.get('/me/onboarding', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const [profile, account] = await Promise.all([
      prisma.userProfile.findUnique({
        where: { id: userId },
        select: {
          username: true,
          display_name: true,
          username_set_at: true,
          onboarding_skipped_at: true,
          onboarding_required: true,
        },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    ]);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const hasChosenUsername = profile.username_set_at !== null;
    // False only for accounts that predate the picker; the migration
    // backfilled them. For those the prompt is dismissible.
    const skippable = !profile.onboarding_required;
    const alreadyDismissed = profile.onboarding_skipped_at !== null;

    const showPicker = !hasChosenUsername && !(skippable && alreadyDismissed);

    const suggestions = showPicker
      ? await availableSuggestions(
          profile.display_name,
          account?.email?.split('@')[0] ?? account?.name ?? null,
          userId,
        )
      : [];

    res.json({
      username: profile.username,
      display_name: profile.display_name,
      username_is_generated: isGeneratedUsername(profile.username),
      has_chosen_username: hasChosenUsername,
      show_picker: showPicker,
      skippable,
      can_change_at: usernameChangeAvailableAt(profile.username_set_at)?.toISOString() ?? null,
      suggestions,
      limits: {
        min_length: USERNAME_MIN_LENGTH,
        max_length: USERNAME_MAX_LENGTH,
        cooldown_days: USERNAME_CHANGE_COOLDOWN_DAYS,
        max_suggestions: MAX_USERNAME_SUGGESTIONS,
      },
    });
  } catch (err) {
    console.error('[Users] me/onboarding error:', err);
    res.status(500).json({ error: 'Failed to load onboarding state' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/me/onboarding/skip - dismiss the picker.
//
// Refused for accounts created after the picker shipped: they were offered the
// choice at the only moment it is cheap to make, so for them it is a gate.
// Accounts that predate it never had that chance and can dismiss.
// ---------------------------------------------------------------------------
router.post(
  '/me/onboarding/skip',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const profile = await prisma.userProfile.findUnique({
        where: { id: userId },
        select: { username_set_at: true, onboarding_required: true },
      });

      if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      // Idempotent: a user who has already chosen has nothing to dismiss, and
      // answering 409 here would make a double-tap look like a failure.
      if (profile.username_set_at !== null) {
        return res.json({ skipped: false, show_picker: false });
      }

      if (profile.onboarding_required) {
        return res.status(409).json({
          error: 'Choose a username to continue.',
          code: 'ONBOARDING_REQUIRED',
        });
      }

      await prisma.userProfile.update({
        where: { id: userId },
        data: { onboarding_skipped_at: new Date() },
      });

      res.json({ skipped: true, show_picker: false });
    } catch (err) {
      console.error('[Users] me/onboarding/skip error:', err);
      res.status(500).json({ error: 'Failed to dismiss onboarding' });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/users/me/username - claim or change the caller's handle.
//
// Separate from PUT /me/profile on purpose. That route is a bulk patch where
// unknown keys are silently dropped; a handle is a globally unique identity
// with a cooldown, a release record and three distinct 409s. Folding it in
// would mean a caller who mistypes the key gets a 200 and no username change.
// ---------------------------------------------------------------------------
router.put(
  '/me/username',
  requireAuth,
  usernameClaimLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const check = validateUsername((req.body as { username?: unknown })?.username);
      if (!check.ok) {
        return res.status(400).json({ error: check.message, code: check.code });
      }

      const current = await prisma.userProfile.findUnique({
        where: { id: userId },
        select: { username: true, username_normalized: true, username_set_at: true },
      });
      if (!current) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      // Casing edits keep the same identity: nothing is released, so no
      // cooldown applies and no hold is created.
      const sameIdentity = current.username_normalized === check.normalized;

      if (current.username === check.username && current.username_set_at !== null) {
        // A no-op must not restart the cooldown clock. Answer with the current
        // state so the client can settle without a second request.
        const profile = await prisma.userProfile.findUnique({
          where: { id: userId },
          select: OWN_PROFILE_SELECT,
        });
        return res.json({ profile, unchanged: true });
      }

      if (!sameIdentity) {
        const cooldown = checkUsernameCooldown(current.username_set_at);
        if (cooldown.blocked) {
          return res.status(409).json({
            error: 'You changed your username recently. You can change it again later.',
            code: 'USERNAME_CHANGE_TOO_SOON',
            available_at: cooldown.availableAt.toISOString(),
          });
        }

        const held = await prisma.usernameHistory.findFirst({
          where: {
            username_normalized: check.normalized,
            released_at: { gt: releasedUsernameHoldCutoff() },
            profile_id: { not: userId },
          },
          select: { id: true },
        });
        if (held) {
          return res.status(409).json({
            error: 'That username was recently in use and is not available yet.',
            code: 'USERNAME_ON_HOLD',
          });
        }
      }

      const profile = await prisma.$transaction(async (tx) => {
        if (!sameIdentity) {
          // Record the release before taking the new handle, so the old one is
          // held against everyone else from this instant rather than from
          // whenever a later statement happened to run.
          await tx.usernameHistory.create({
            data: {
              profile_id: userId,
              username: current.username,
              username_normalized: current.username_normalized,
            },
          });
          // Reclaiming a handle this same account released: drop the hold, or
          // the owner would be blocked from their own former identity.
          await tx.usernameHistory.deleteMany({
            where: { profile_id: userId, username_normalized: check.normalized },
          });
        }

        return tx.userProfile.update({
          where: { id: userId },
          data: {
            username: check.username,
            username_normalized: check.normalized,
            username_set_at: new Date(),
            // Choosing settles onboarding however it was reached, including
            // for a user who dismissed the prompt and came back via settings.
            onboarding_skipped_at: null,
          },
          select: OWN_PROFILE_SELECT,
        });
      });

      res.json({ profile, unchanged: false });
    } catch (err) {
      // The availability check above is advisory: two callers can pass it
      // concurrently and only one can win the unique index. The loser gets the
      // same 409 they would have received a moment earlier.
      if (isUsernameConflict(err)) {
        return res.status(409).json({ error: 'That username is taken.', code: 'USERNAME_TAKEN' });
      }
      console.error('[Users] me/username error:', err);
      res.status(500).json({ error: 'Failed to update your username' });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/users/suggested - get suggested creators to follow
// NOTE: Must be defined before /:id to avoid route shadowing.
// ---------------------------------------------------------------------------
router.get('/suggested', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const parsedLimit = parseInt((req.query.limit as string) || '10', 10);
    const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 10 : parsedLimit, 1), 50);

    // Get user's profile
    const userProfile = await prisma.userProfile.findUnique({
      where: { id: userId },
      select: { location: true },
    });

    // Get users already following, blocked (either direction), and users
    // with a pending outgoing request — none should be suggested.
    const [following, blocks, pendingRequests] = await Promise.all([
      prisma.connection.findMany({
        where: { follower_id: userId },
        select: { following_id: true },
      }),
      prisma.userBlock.findMany({
        where: { OR: [{ blocker_id: userId }, { blocked_id: userId }] },
        select: { blocker_id: true, blocked_id: true },
      }),
      prisma.connectionRequest.findMany({
        where: { requester_id: userId, status: 'pending' },
        select: { target_id: true },
      }),
    ]);

    const followingIds = following.map((f) => f.following_id);
    const blockedIds = blocks.flatMap((b) =>
      [b.blocker_id, b.blocked_id].filter((id) => id !== userId),
    );
    const pendingTargetIds = pendingRequests.map((r) => r.target_id);
    const excludeIds = [
      ...new Set([...followingIds, ...blockedIds, ...pendingTargetIds, userId]),
    ];

    // STRATEGY 1: Users with mutual connections
    // Find users followed by the people I follow (friends-of-friends)
    const mutualCrewSuggestions: Map<
      string,
      {
        id: string;
        username: string;
        display_name: string;
        avatar_url: string | null;
        bio: string | null;
        is_verified: boolean;
        account_type: string;
        partycrew_count: number;
        events_hosted: number;
        haus_score: number;
        reason: string;
        mutual_crew_count: number;
        same_location: boolean;
      }
    > = new Map();

    if (followingIds.length > 0) {
      // Friends-of-friends, aggregated in ONE grouped query: candidates are
      // ranked by how many of MY follows also follow them. (The previous
      // version took 20 arbitrary connection ROWS with no orderBy — heap
      // order, nondeterministic — then ran a per-candidate RPC that was
      // type-incompatible with the prisma-pushed TEXT id columns.)
      const grouped = await prisma.connection.groupBy({
        by: ['following_id'],
        where: {
          follower_id: { in: followingIds },
          following_id: { notIn: excludeIds },
        },
        _count: { following_id: true },
        orderBy: { _count: { following_id: 'desc' } },
        take: 20,
      });

      const candidateIds = grouped.map((g) => g.following_id);
      const countByCandidate = new Map(
        grouped.map((g) => [g.following_id, g._count.following_id]),
      );

      const candidateProfiles = candidateIds.length
        ? await prisma.userProfile.findMany({
            where: { id: { in: candidateIds }, is_private: false },
            select: {
              id: true,
              username: true,
              display_name: true,
              avatar_url: true,
              bio: true,
              is_verified: true,
              account_type: true,
              partycrew_count: true,
              events_hosted: true,
              haus_score: true,
              location: true,
            },
          })
        : [];

      for (const profile of candidateProfiles) {
        // "Followed by K of the people I follow" — the shared-third-party
        // INTERSECT definition of mutual crew.
        const mutualCount = countByCandidate.get(profile.id) || 0;
        mutualCrewSuggestions.set(profile.id, {
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          bio: profile.bio,
          is_verified: profile.is_verified,
          account_type: profile.account_type,
          partycrew_count: profile.partycrew_count,
          events_hosted: profile.events_hosted,
          haus_score: profile.haus_score,
          reason: `${mutualCount} mutual PartyCrew member${mutualCount === 1 ? '' : 's'}`,
          mutual_crew_count: mutualCount,
          same_location: userProfile?.location === profile.location && !!profile.location,
        });
      }
    }

    const mutualSuggestions = Array.from(mutualCrewSuggestions.values()).sort(
      (a, b) => b.mutual_crew_count - a.mutual_crew_count,
    );

    // STRATEGY 2: Popular creators in same location
    const locationSuggestions: typeof mutualSuggestions = [];

    if (userProfile?.location && mutualSuggestions.length < limit) {
      const alreadySuggestedIds = [
        ...excludeIds,
        ...mutualSuggestions.map((s) => s.id),
      ];

      const locationCreators = await prisma.userProfile.findMany({
        where: {
          location: userProfile.location,
          id: { notIn: alreadySuggestedIds },
          is_private: false,
          events_hosted: { gte: 1 },
        },
        orderBy: { partycrew_count: 'desc' },
        take: 10,
      });

      for (const profile of locationCreators) {
        locationSuggestions.push({
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          bio: profile.bio,
          is_verified: profile.is_verified,
          account_type: profile.account_type,
          partycrew_count: profile.partycrew_count,
          events_hosted: profile.events_hosted,
          haus_score: profile.haus_score,
          reason: `Popular in ${userProfile.location}`,
          mutual_crew_count: 0,
          same_location: true,
        });
      }
    }

    // STRATEGY 3: Verified creators with high engagement
    const verifiedSuggestions: typeof mutualSuggestions = [];

    if (mutualSuggestions.length + locationSuggestions.length < limit) {
      const alreadySuggestedIds = [
        ...excludeIds,
        ...mutualSuggestions.map((s) => s.id),
        ...locationSuggestions.map((s) => s.id),
      ];

      const verifiedCreators = await prisma.userProfile.findMany({
        where: {
          is_verified: true,
          id: { notIn: alreadySuggestedIds },
          is_private: false,
          events_hosted: { gte: 3 },
        },
        orderBy: { haus_score: 'desc' },
        take: 10,
      });

      for (const profile of verifiedCreators) {
        verifiedSuggestions.push({
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          bio: profile.bio,
          is_verified: profile.is_verified,
          account_type: profile.account_type,
          partycrew_count: profile.partycrew_count,
          events_hosted: profile.events_hosted,
          haus_score: profile.haus_score,
          reason: 'Verified creator',
          mutual_crew_count: 0,
          same_location: false,
        });
      }
    }

    // Combine and limit suggestions
    const allSuggestions = [
      ...mutualSuggestions,
      ...locationSuggestions,
      ...verifiedSuggestions,
    ].slice(0, limit);

    return res.status(200).json({
      suggestions: allSuggestions,
      total: allSuggestions.length,
    });
  } catch (error: unknown) {
    console.error('[Suggested Creators Error]:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/users/:id - get user profile with connection info
// ---------------------------------------------------------------------------
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.params.id;
    const viewerId = req.user?.id || null;

    if (!userId) {
      return res.status(400).json({ error: 'Missing user ID' });
    }

    // Get user profile
    const profile = await prisma.userProfile.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Initialize viewer relationship data
    let viewerIsFollowing = false;
    let viewerIsFollower = false;
    let viewerIsMutual = false;
    let viewerHasPendingRequest = false;
    let viewerIsBlocked = false;
    let viewerHasBlocked = false;
    let mutualCrewCount: number | undefined;

    if (viewerId) {
      // Check if viewer is following this user
      const followingConn = await prisma.connection.findFirst({
        where: { follower_id: viewerId, following_id: userId },
        select: { id: true },
      });
      viewerIsFollowing = !!followingConn;

      // Check if this user is following viewer
      const followerConn = await prisma.connection.findFirst({
        where: { follower_id: userId, following_id: viewerId },
        select: { id: true },
      });
      viewerIsFollower = !!followerConn;
      viewerIsMutual = viewerIsFollowing && viewerIsFollower;

      // Check for pending request
      const pendingRequest = await prisma.connectionRequest.findFirst({
        where: {
          requester_id: viewerId,
          target_id: userId,
          status: 'pending',
        },
        select: { id: true },
      });
      viewerHasPendingRequest = !!pendingRequest;

      // Check if viewer is blocked
      const blocked = await prisma.userBlock.findFirst({
        where: { blocker_id: userId, blocked_id: viewerId },
        select: { id: true },
      });
      viewerIsBlocked = !!blocked;

      // Check if viewer has blocked this user
      const hasBlocked = await prisma.userBlock.findFirst({
        where: { blocker_id: viewerId, blocked_id: userId },
        select: { id: true },
      });
      viewerHasBlocked = !!hasBlocked;

      // Mutual crew count = |following(viewer) ∩ following(target)|.
      // Computed with two Prisma queries instead of the get_mutual_crew_count
      // RPC, whose uuid-typed params cannot bind against the prisma-pushed
      // TEXT id columns. Skipped for self-view (it would just equal
      // crewing_count and mean nothing).
      if (viewerId !== userId) {
        const viewerFollowing = await prisma.connection.findMany({
          where: { follower_id: viewerId },
          select: { following_id: true },
        });
        const viewerFollowingIds = viewerFollowing.map((c) => c.following_id);
        mutualCrewCount = viewerFollowingIds.length
          ? await prisma.connection.count({
              where: {
                follower_id: userId,
                following_id: { in: viewerFollowingIds },
              },
            })
          : 0;
      }
    }

    // A viewer the owner has blocked should not see the profile at all —
    // indistinguishable from a nonexistent account.
    if (viewerIsBlocked) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isSelf = viewerId === userId;

    const viewerFlags = {
      viewer_is_following: viewerIsFollowing,
      viewer_is_follower: viewerIsFollower,
      viewer_is_mutual: viewerIsMutual,
      viewer_has_pending_request: viewerHasPendingRequest,
      viewer_is_blocked: viewerIsBlocked,
      viewer_has_blocked: viewerHasBlocked,
      mutual_crew_count: mutualCrewCount,
    };

    // Private account viewed by a non-follower: minimal public card only.
    // This is deliberately more permissive than the row-level-security policy
    // it replaced, which made private profiles unselectable by other users
    // entirely. A hard 404 would make "this account is private" and "this
    // account does not exist" indistinguishable, so a follow request could
    // never be sent. The reduced card carries no post, event or crew data.
    if (profile.is_private && !isSelf && !viewerIsFollowing) {
      return res.status(200).json({
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        bio: null,
        avatar_url: profile.avatar_url,
        cover_photo_url: null,
        location: null,
        website_url: null,

        partycrew_count: profile.partycrew_count,
        crewing_count: profile.crewing_count,
        events_hosted: profile.events_hosted,
        haus_score: profile.haus_score,

        is_verified: profile.is_verified,
        is_private: profile.is_private,
        account_type: profile.account_type,

        ...viewerFlags,

        created_at: profile.created_at,
        last_active_at: null,
      });
    }

    return res.status(200).json({
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      bio: profile.bio,
      avatar_url: profile.avatar_url,
      cover_photo_url: profile.cover_photo_url,
      location: profile.location,
      website_url: profile.website_url,

      partycrew_count: profile.partycrew_count,
      crewing_count: profile.crewing_count,
      events_hosted: profile.events_hosted,
      haus_score: profile.haus_score,

      is_verified: profile.is_verified,
      is_private: profile.is_private,
      account_type: profile.account_type,

      ...viewerFlags,

      created_at: profile.created_at,
      // Honor the owner's activity-visibility preference.
      last_active_at: isSelf || profile.show_activity_status ? profile.last_active_at : null,
    });
  } catch (error: unknown) {
    console.error('[User Profile Error]:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
