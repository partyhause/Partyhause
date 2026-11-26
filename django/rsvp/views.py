import re
from hashlib import sha256

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from guests.models import Guest
from rsvp.models import GuestInvitation

RSVP_CHOICES = {'accepted', 'maybe', 'declined'}
TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9_-]{43}$')


def token_hash(value):
    """SHA-256 digest of the raw invitation token, matching how it is stored."""
    return sha256(value.encode()).hexdigest()


def mask_email(email):
    """Mask an address for a hint: `a****@example.com`, never the full value."""
    if not email or '@' not in email:
        return '****'
    at = email.rindex('@')
    local = email[:at]
    domain = email[at:]
    return f"{local[0]}{'*' * max(len(local) - 1, 1)}{domain}"


def _normalise_status(value):
    if value == 'confirmed':
        return 'accepted'
    return value or 'pending'


def _invitation_payload(invitation):
    event = invitation.event
    guest = invitation.guest
    return {
        'event': {
            'name': event.name,
            'hostName': (
                event.host.name
                if event.host and event.host.name
                else (event.host.email if event.host else '')
            ),
            'start': event.start_date.isoformat() if event.start_date else '',
            'end': event.end_date.isoformat() if event.end_date else '',
            'timezone': event.timezone or 'UTC',
            'location': event.location or '',
        },
        'rsvp': {
            'status': _normalise_status(guest.rsvp_status),
            'revision': guest.revision,
            'respondedAt': (
                guest.rsvp_responded_at.isoformat()
                if guest.rsvp_responded_at
                else None
            ),
            'requiresAccount': invitation.requires_account,
            'claimed': bool(guest.user_id),
            'invitedEmailHint': mask_email(
                guest.normalized_email or guest.email
            ),
        },
    }


def _unavailable():
    return Response(
        {'code': 'RSVP_UNAVAILABLE', 'error': 'This invitation is unavailable'},
        status=status.HTTP_404_NOT_FOUND,
    )


def _find_invitation(raw_token):
    if not isinstance(raw_token, str) or not TOKEN_PATTERN.match(raw_token):
        return None
    try:
        invitation = GuestInvitation.objects.select_related(
            'event', 'event__host', 'guest'
        ).get(token=token_hash(raw_token))
    except GuestInvitation.DoesNotExist:
        return None
    if invitation.revoked or invitation.expires_at < timezone.now():
        return None
    return invitation


class RsvpResolveView(APIView):
    """
    POST /api/rsvp/resolve/

    Read an invitation without changing it. Deliberately unauthenticated:
    the invitee must be able to see what they are being asked to attend
    before deciding whether to create an account.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get('token')
        if not token or not isinstance(token, str):
            return Response(
                {'code': 'INVALID_REQUEST', 'error': 'Request body must include token'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        invitation = _find_invitation(token)
        if invitation is None:
            return _unavailable()
        return Response(_invitation_payload(invitation), status=status.HTTP_200_OK)


class RsvpView(APIView):
    """
    PUT /api/rsvp/ — record an RSVP response.

    The invitation decides the authentication regime. `requires_account` is a
    per-invitation switch: when false (the default while the app is
    iPhone-only), an invitee may answer without an account. When true, the
    caller must be signed in as the invited address. A signed-in caller whose
    address matches the invitation claims the seat.
    """

    permission_classes = [AllowAny]

    def put(self, request):
        return self._respond(request)

    def post(self, request):
        return self._respond(request)

    def _respond(self, request):
        token = request.data.get('token')
        choice = request.data.get('status')
        expected_revision = request.data.get('expectedRevision')

        if not token or not isinstance(token, str):
            return Response(
                {'code': 'INVALID_REQUEST', 'error': 'Request body must include token'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if choice not in RSVP_CHOICES:
            return Response(
                {
                    'code': 'INVALID_REQUEST',
                    'error': 'status must be accepted, maybe, or declined',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            expected_revision = int(expected_revision)
        except (TypeError, ValueError):
            return Response(
                {
                    'code': 'INVALID_REQUEST',
                    'error': 'expectedRevision is required',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        invitation = _find_invitation(token)
        if invitation is None:
            return _unavailable()

        guest = invitation.guest
        # DRF's Request.user is AnonymousUser when no DRF authentication class
        # is configured, even though JWTAuthenticationMiddleware set the
        # underlying Django request's user. Read the request the middleware
        # actually populated.
        django_request = getattr(request, '_request', request)
        django_user = getattr(django_request, 'user', None)
        user = django_user if getattr(django_user, 'is_authenticated', False) else None
        invited_email = (invitation.email or guest.email or '').strip().lower()
        user_email = (getattr(user, 'email', '') or '').strip().lower()

        # The authorization check runs before the idempotent early return: an
        # unauthorized caller must not be able to learn the stored answer by
        # submitting each status in turn.
        if guest.user_id is not None:
            if user is None or str(guest.user_id) != str(user.id):
                return Response(
                    {
                        'code': 'RSVP_ALREADY_CLAIMED',
                        'error': 'This seat has already been claimed by an account',
                    },
                    status=status.HTTP_409_CONFLICT,
                )
        if invitation.requires_account:
            if user is None:
                return Response(
                    {
                        'code': 'RSVP_ACCOUNT_REQUIRED',
                        'error': 'Sign in to answer this invitation',
                    },
                    status=status.HTTP_401_UNAUTHORIZED,
                )
            if user_email != invited_email:
                return Response(
                    {
                        'code': 'RSVP_EMAIL_MISMATCH',
                        'error': 'This invitation was sent to a different address',
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        if user is not None and user_email == invited_email:
            held = (
                Guest.objects.filter(event=invitation.event, user_id=user.id)
                .exclude(id=guest.id)
                .exists()
            )
            if held:
                return Response(
                    {
                        'code': 'RSVP_SEAT_ALREADY_HELD',
                        'error': 'Your account already holds a seat at this event',
                    },
                    status=status.HTTP_409_CONFLICT,
                )

        if guest.revision != expected_revision:
            return Response(
                {
                    'code': 'REVISION_CONFLICT',
                    'error': 'This invitation changed since it was read',
                    'rsvp': _invitation_payload(invitation)['rsvp'],
                },
                status=status.HTTP_409_CONFLICT,
            )

        if choice in ('accepted', 'maybe'):
            accepted = Guest.objects.filter(
                event=invitation.event,
                rsvp_status__in=['accepted', 'confirmed'],
            ).exclude(id=guest.id).count()
            if invitation.event.max_guests and accepted >= invitation.event.max_guests:
                return Response(
                    {
                        'code': 'RSVP_EVENT_FULL',
                        'error': 'This event is at capacity',
                    },
                    status=status.HTTP_409_CONFLICT,
                )

        guest.rsvp_status = choice
        guest.rsvp_responded_at = timezone.now()
        guest.revision += 1
        if user is not None and user_email == invited_email and guest.user_id is None:
            guest.user_id = user.id
        guest.save()
        guest.refresh_from_db()

        return Response(_invitation_payload(invitation), status=status.HTTP_200_OK)
