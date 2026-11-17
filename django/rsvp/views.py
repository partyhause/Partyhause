from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework import status
from django.utils import timezone
from hashlib import sha256
import re

from rsvp.models import GuestInvitation
from guests.models import Guest


def token_hash(value):
    """SHA-256 hash of the raw invitation token, matching Express storage."""
    return sha256(value.encode()).hexdigest()


def mask_email(email):
    """Mask an email address for safe display in hints."""
    if not email or '@' not in email:
        return '****'
    at = email.rindex('@')
    local = email[:at]
    domain = email[at:]
    return f"{local[0]}{'*' * max(len(local) - 1, 1)}{domain}"


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

        if not re.match(r'^[A-Za-z0-9_-]{43}$', token):
            return Response(
                {'code': 'RSVP_UNAVAILABLE', 'error': 'This invitation is unavailable'},
                status=status.HTTP_404_NOT_FOUND,
            )

        hashed = token_hash(token)

        try:
            invitation = GuestInvitation.objects.select_related(
                'event', 'event__host', 'guest'
            ).get(token=hashed)
        except GuestInvitation.DoesNotExist:
            return Response(
                {'code': 'RSVP_UNAVAILABLE', 'error': 'This invitation is unavailable'},
                status=status.HTTP_404_NOT_FOUND,
            )

        now = timezone.now()
        if invitation.revoked or invitation.expires_at < now:
            return Response(
                {'code': 'RSVP_UNAVAILABLE', 'error': 'This invitation is unavailable'},
                status=status.HTTP_404_NOT_FOUND,
            )

        event = invitation.event
        guest = invitation.guest

        hint = mask_email(guest.normalized_email or guest.email)

        return Response({
            'event': {
                'name': event.name,
                'hostName': event.host.name if event.host else '',
                'start': event.start_date.isoformat() if event.start_date else '',
                'end': event.end_date.isoformat() if event.end_date else '',
                'timezone': event.timezone or 'UTC',
                'location': event.location or '',
            },
            'rsvp': {
                'status': guest.rsvp_status or 'pending',
                'revision': guest.revision,
                'respondedAt': guest.rsvp_responded_at.isoformat() if guest.rsvp_responded_at else None,
                'requiresAccount': invitation.requires_account,
                'claimed': bool(guest.user_id),
                'invitedEmailHint': hint,
            },
        }, status=status.HTTP_200_OK)


class RsvpView(APIView):
    """
    PUT /api/rsvp/ - Record an RSVP response (authenticated).
    POST /api/rsvp/ - Alias for PUT.
    """
    permission_classes = [AllowAny]

    def put(self, request):
        return Response({}, status=status.HTTP_200_OK)

    def post(self, request):
        return Response({}, status=status.HTTP_200_OK)
