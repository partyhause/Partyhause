// Express route: /api/invites
// Event invite token generation, joining, and guest-to-crew conversion
// Replaces Vercel serverless functions api/generate-invite.ts, api/join-event.ts,
// and api/convert-guest-to-crew.ts

import { Router } from 'express';
import type { Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import type { AuthenticatedRequest } from '../middleware/auth';
import { isUniqueViolation } from '../lib/db-errors';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/invites/generate - generate invite token for an event
// ---------------------------------------------------------------------------
router.post('/generate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      event_id,
      token_type = 'guest_and_crew',
      max_uses = null,
      expires_in_hours = null,
      allowed_emails = null,
      require_approval = false,
    } = req.body;

    if (!event_id) {
      return res.status(400).json({ error: 'event_id required' });
    }

    // Verify user is event host
    const event = await prisma.event.findUnique({
      where: { id: event_id },
      select: { host_id: true },
    });

    if (!event || event.host_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to manage this event' });
    }

    // Calculate expiration
    const expires_at = expires_in_hours
      ? new Date(Date.now() + expires_in_hours * 60 * 60 * 1000)
      : null;

    // Generate token (call DB function)
    const tokenResult = await prisma.$queryRaw<{ token: string }[]>`
      SELECT generate_invite_token() AS token
    `;
    const token = tokenResult[0].token;

    // Insert invite token
    const inviteToken = await prisma.eventInviteToken.create({
      data: {
        event_id,
        token,
        token_type,
        max_uses,
        expires_at,
        allowed_emails: allowed_emails || [],
        require_approval,
        created_by: userId,
      },
    });

    // Generate QR code data
    const baseUrl = process.env.VITE_APP_URL || 'https://www.partyhause.com';
    const inviteUrl = `${baseUrl}/join/${token}`;

    return res.status(201).json({
      token: inviteToken,
      invite_url: inviteUrl,
      qr_data: inviteUrl,
    });
  } catch (error: unknown) {
    console.error('Generate invite error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal server error', message: errorMessage });
  }
});

// ---------------------------------------------------------------------------
// POST /api/invites/join - join event as guest via invite token (QR code)
// ---------------------------------------------------------------------------
// Requires an account. Joining an event through a shared link records an RSVP
// (`accepted`, below), so leaving this on optionalAuth would have kept an
// anonymous RSVP path open under a second URL while /api/rsvp closed its own.
// The previous handler accepted a name and email from a signed-out caller,
// which meant a guest list could contain rows nobody could ever be held to.
// Unlike the emailed per-guest invitations, EventInviteToken links are
// shareable by design and address nobody in particular, so there is no
// grandfathered set here: there is no address to have proven.
router.post('/join', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const userEmail = (user.email || '').trim().toLowerCase();
    const { token, name, also_add_to_crew = false } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'token required' });
    }
    if (!userEmail) {
      return res.status(403).json({
        error: 'Your account has no email address on file',
        code: 'ACCOUNT_EMAIL_MISSING',
      });
    }

    // Get token details with event (read-only; usage is incremented later,
    // after the idempotent "already joined" check, so re-scanning a QR code
    // does not burn max_uses).
    const tokenData = await prisma.eventInviteToken.findUnique({
      where: { token },
      include: {
        event: true,
      },
    });

    if (!tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const event_id = tokenData.event_id;
    const token_type = tokenData.token_type;

    // Check if user is already a guest - must happen BEFORE the usage
    // increment so repeat scans are idempotent and free.
    const existingGuest = await prisma.guest.findFirst({
      where: {
        event_id,
        user_id: user.id,
      },
      select: { id: true, rsvp_status: true },
    });

    if (existingGuest) {
      return res.status(200).json({
        message: 'Already joined this event',
        guest: existingGuest,
        event: tokenData.event,
      });
    }

    // The host may already have added this person by email. That row is the
    // seat; creating a second one would collide with the unique index on
    // (event_id, normalized_email) and, if it somehow did not, would give one
    // person two places and two check-ins. Claim it instead of duplicating it.
    const invitedSeat = await prisma.guest.findFirst({
      where: { event_id, normalized_email: userEmail, user_id: null },
      select: { id: true },
    });

    // Validate and atomically increment token usage via RPC
    // (SELECT ... FOR UPDATE inside the function guards max_uses races).
    const usageResult = await prisma.$queryRaw<{ valid: boolean }[]>`
      SELECT increment_token_usage(${token}, ${user.id}::uuid) AS valid
    `;
    const isValid = usageResult[0]?.valid;

    if (!isValid) {
      return res.status(400).json({
        error: 'Invalid or expired invite token',
        code: 'TOKEN_INVALID',
      });
    }

    // The rsvp_status vocabulary is ('pending','accepted','declined','maybe');
    // see Guest.rsvp_status in prisma/schema.prisma and the
    // guests_rsvp_status_check constraint added by
    // 20260905000200_core_integrity_constraints. Joining via an invite link
    // counts as accepting the invitation.
    const rsvpStatus = tokenData.require_approval ? 'pending' : 'accepted';
    const guest = invitedSeat
      ? await prisma.guest.update({
          where: { id: invitedSeat.id },
          data: {
            user_id: user.id,
            rsvp_status: rsvpStatus,
            rsvp_responded_at: new Date(),
            revision: { increment: 1 },
          },
        })
      : await prisma.guest.create({
          data: {
            event_id,
            name: (typeof name === 'string' && name.trim()) || user.name || 'Guest',
            email: userEmail,
            user_id: user.id,
            rsvp_status: rsvpStatus,
            rsvp_responded_at: new Date(),
            email_status: 'not_sent',
          },
        });

    // Handle crew connection if requested
    let connection: {
      type: string;
      request?: unknown;
      connection?: unknown;
    } | null = null;

    if (
      also_add_to_crew &&
      (token_type === 'crew_invite' || token_type === 'guest_and_crew')
    ) {
      const hostId = tokenData.event.host_id;

      // Check if connection already exists
      const existingConn = await prisma.connection.findFirst({
        where: { follower_id: user.id, following_id: hostId },
        select: { id: true },
      });

      if (!existingConn) {
        // Check if host is private
        const hostProfile = await prisma.userProfile.findUnique({
          where: { id: hostId },
          select: { is_private: true },
        });

        if (hostProfile?.is_private) {
          // Send connection request
          const request = await prisma.connectionRequest.create({
            data: {
              requester_id: user.id,
              target_id: hostId,
              status: 'pending',
              message: `Met at: ${tokenData.event.name}`,
            },
          });
          connection = { type: 'request_sent', request };
        } else {
          // Create direct connection
          const conn = await prisma.connection.create({
            data: {
              follower_id: user.id,
              following_id: hostId,
            },
          });

          // Log conversion
          await prisma.guestCrewConversion.create({
            data: {
              event_id,
              guest_id: guest.id,
              user_id: user.id,
              converted_by: user.id,
              conversion_type: 'guest_accepted',
              connection_id: conn.id,
              connection_status: 'accepted',
            },
          });

          connection = { type: 'connected', connection: conn };
        }
      } else {
        connection = { type: 'already_connected' };
      }
    }

    return res.status(201).json({
      message: 'Successfully joined event',
      guest,
      event: tokenData.event,
      connection,
      show_crew_prompt:
        !also_add_to_crew &&
        (token_type === 'crew_invite' || token_type === 'guest_and_crew'),
    });
  } catch (error: unknown) {
    // Two taps on the same link race past the "already joined" read above,
    // and guests_event_id_user_id_key is what stops the loser writing a second
    // seat. That is the constraint doing its job, not a server fault, so the
    // loser is told what is true: they are already on the list.
    if (isUniqueViolation(error)) {
      return res.status(200).json({ message: 'Already joined this event' });
    }
    console.error('Join event error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal server error', message: errorMessage });
  }
});

// ---------------------------------------------------------------------------
// POST /api/invites/convert-guest - convert event guest to crew member (host-initiated)
// ---------------------------------------------------------------------------
router.post('/convert-guest', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { guest_id, event_id } = req.body;

    if (!guest_id || !event_id) {
      return res.status(400).json({ error: 'guest_id and event_id required' });
    }

    // Verify user is event host
    const event = await prisma.event.findUnique({
      where: { id: event_id },
      select: { host_id: true },
    });

    if (!event || event.host_id !== userId) {
      return res.status(403).json({ error: 'Only event host can convert guests to crew' });
    }

    // Call DB function to convert
    let connectionId: string;
    try {
      const result = await prisma.$queryRaw<{ connection_id: string }[]>`
        SELECT convert_guest_to_crew(
          ${guest_id}::uuid,
          ${userId}::uuid,
          'host_promoted'
        ) AS connection_id
      `;
      connectionId = result[0].connection_id;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already in crew')) {
        return res.status(400).json({ error: 'Guest is already in your crew' });
      }
      if (msg.includes('must have a user account')) {
        return res.status(400).json({
          error: 'Guest must sign up for an account before being added to crew',
          code: 'GUEST_NO_ACCOUNT',
        });
      }
      throw error;
    }

    // Get updated connection details
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: {
        id: true,
        created_at: true,
        follower: {
          select: {
            id: true,
            username: true,
            display_name: true,
            avatar_url: true,
            bio: true,
          },
        },
      },
    });

    return res.status(201).json({
      message: 'Guest promoted to crew successfully',
      connection,
      connection_id: connectionId,
    });
  } catch (error: unknown) {
    console.error('Convert guest to crew error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal server error', message: errorMessage });
  }
});

export default router;
