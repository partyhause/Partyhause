import logging
import uuid

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin
from events.models import Event, EventCoHost

from .models import Guest

logger = logging.getLogger(__name__)

RSVP_STATUSES = {'accepted', 'confirmed', 'declined', 'maybe', 'pending'}


def _co_host(event, user):
    if not event or not user or not user.is_authenticated:
        return None
    return EventCoHost.objects.filter(event=event, user=user).first()


def can_manage_guests(event, user):
    """Host or a co-host with an editing role."""
    if not event or not user or not user.is_authenticated:
        return False
    if event.host_id == user.id:
        return True
    co_host = _co_host(event, user)
    if co_host is None:
        return False
    return co_host.role in ('host', 'co-host', 'editor', 'organizer')


def can_invite_guests(event, user):
    if can_manage_guests(event, user):
        return True
    co_host = _co_host(event, user)
    if co_host is None:
        return False
    return bool((co_host.permissions or {}).get('can_invite'))


def is_own_guest_record(guest, user):
    if not guest or not user or not user.is_authenticated:
        return False
    if guest.user_id and str(guest.user_id) == str(user.id):
        return True
    return bool(
        user.email
        and guest.email
        and guest.email.strip().lower() == user.email.strip().lower()
    )


def _guest_payload(guest):
    return {
        'id': str(guest.id),
        'event_id': str(guest.event_id),
        'name': guest.name,
        'email': guest.email,
        'normalized_email': guest.normalized_email,
        'rsvp_status': guest.rsvp_status,
        'rsvp_responded_at': (
            guest.rsvp_responded_at.isoformat() if guest.rsvp_responded_at else None
        ),
        'checked_in': guest.checked_in,
        'checked_in_at': guest.checked_in_at.isoformat() if guest.checked_in_at else None,
        'user_id': str(guest.user_id) if guest.user_id else None,
        'revision': guest.revision,
        'created_at': guest.created_at.isoformat(),
    }


def _parse_uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


class IndexGuestsView(SessionAuthMixin, APIView):
    """GET /api/guests/?eventId=... — list an event's guest list.

    The list is not public: it contains every guest's address. A host or
    co-host may read it. A guest reading a single record (`?id=`) must be
    that guest.
    """

    def get(self, request):
        event_id = request.query_params.get('eventId') or request.query_params.get('event_id')
        guest_id = request.query_params.get('id')

        if guest_id:
            guest_uuid = _parse_uuid(guest_id)
            if guest_uuid is None:
                return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)
            guest = Guest.objects.select_related('event').filter(id=guest_uuid).first()
            if guest is None:
                return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)
            if not (
                can_manage_guests(guest.event, request.user)
                or is_own_guest_record(guest, request.user)
            ):
                # 404 rather than 403: a probe must not learn that the id exists.
                return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)
            return Response({'guest': _guest_payload(guest)})

        if not event_id:
            return Response(
                {'error': 'eventId is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        event_uuid = _parse_uuid(event_id)
        if event_uuid is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        event = Event.objects.filter(id=event_uuid).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        if not can_manage_guests(event, request.user):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        guests = Guest.objects.filter(event=event).order_by('created_at')
        data = [_guest_payload(guest) for guest in guests]
        return Response({
            'guests': data,
            'stats': {
                'total': len(data),
                'accepted': sum(1 for g in data if g['rsvp_status'] in ('accepted', 'confirmed')),
                'declined': sum(1 for g in data if g['rsvp_status'] == 'declined'),
                'pending': sum(1 for g in data if g['rsvp_status'] == 'pending'),
                'checked_in': sum(1 for g in data if g['checked_in']),
            },
            'count': len(data),
        })


class CreateGuestView(SessionAuthMixin, APIView):
    """POST /api/guests/ — add one guest to an event."""

    def post(self, request):
        event_id = request.data.get('event_id') or request.data.get('eventId')
        event_uuid = _parse_uuid(event_id)
        if event_uuid is None:
            return Response({'error': 'event_id required'}, status=status.HTTP_400_BAD_REQUEST)

        event = Event.objects.filter(id=event_uuid).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        if not can_invite_guests(event, request.user):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        name = (request.data.get('name') or '').strip()
        email = (request.data.get('email') or '').strip()
        if not name or not email:
            return Response(
                {'error': 'name and email are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if event.max_guests and Guest.objects.filter(event=event).count() >= event.max_guests:
            return Response({'error': 'Event at capacity'}, status=status.HTTP_400_BAD_REQUEST)

        rsvp_status = request.data.get('rsvp_status', 'pending')
        if rsvp_status not in RSVP_STATUSES:
            return Response({'error': 'Invalid RSVP status'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            guest = Guest.objects.create(
                event=event,
                name=name,
                email=email,
                rsvp_status=rsvp_status,
            )
        except ValidationError:
            return Response({'error': 'Invalid guest data'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Could not create guest for event %s', event.id)
            return Response(
                {'error': 'A guest with that email may already exist'},
                status=status.HTTP_409_CONFLICT,
            )

        try:
            from guests.email_service import GuestInvitationService
            GuestInvitationService(event).send_invitation(guest)
        except Exception:
            # The guest exists even if mail failed; the host can resend.
            logger.exception('Invitation email failed for %s', email)

        payload = _guest_payload(guest)
        payload['qr_code'] = f'partyhause://checkin/{event.id}/{guest.id}'
        return Response(payload, status=status.HTTP_201_CREATED)


class UpdateGuestView(SessionAuthMixin, APIView):
    """PUT/DELETE /api/guests/:id — update or remove a guest."""

    def put(self, request, guest_id):
        guest = Guest.objects.select_related('event').filter(id=guest_id).first()
        if guest is None:
            return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)

        can_manage = can_manage_guests(guest.event, request.user)
        is_own = is_own_guest_record(guest, request.user)
        if not (can_manage or is_own):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        data = request.data
        if not can_manage:
            # A guest may answer for themselves and nothing else. Without this
            # an invitee could rename the seat, change its address, or check
            # themselves in.
            forbidden = {'name', 'email', 'checked_in', 'user_id', 'ticket_type'}
            if forbidden.intersection(data.keys()):
                return Response(
                    {'error': 'Guests may only update their own RSVP'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if 'rsvp_status' in data:
            new_status = data['rsvp_status']
            if new_status not in RSVP_STATUSES:
                return Response(
                    {'error': 'Invalid RSVP status'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if new_status in ('accepted', 'confirmed') and guest.event.max_guests:
                accepted_count = (
                    Guest.objects.filter(
                        event=guest.event, rsvp_status__in=['accepted', 'confirmed']
                    )
                    .exclude(id=guest.id)
                    .count()
                )
                if accepted_count >= guest.event.max_guests:
                    return Response(
                        {'error': 'Event at capacity'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            guest.rsvp_status = new_status
            guest.rsvp_responded_at = timezone.now()

        if can_manage and 'checked_in' in data:
            checked_in = bool(data['checked_in'])
            guest.checked_in = checked_in
            guest.is_checked_in = checked_in
            guest.checked_in_at = timezone.now() if checked_in else None

        if can_manage and 'name' in data:
            guest.name = (data.get('name') or '').strip() or guest.name
        if can_manage and 'email' in data:
            email = (data.get('email') or '').strip()
            if not email:
                return Response({'error': 'email cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
            guest.email = email
            guest.normalized_email = email.lower()

        guest.revision += 1
        guest.save()
        return Response(_guest_payload(guest))

    def delete(self, request, guest_id):
        guest = Guest.objects.select_related('event').filter(id=guest_id).first()
        if guest is None:
            return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)
        if not can_manage_guests(guest.event, request.user):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        guest.delete()
        return Response({'status': 'deleted'})


class BulkCreateGuestsView(SessionAuthMixin, APIView):
    """POST /api/guests/bulk — add several guests in one request."""

    def post(self, request):
        event_id = request.data.get('event_id') or request.data.get('eventId')
        guests_data = request.data.get('guests', [])
        event_uuid = _parse_uuid(event_id)
        if event_uuid is None:
            return Response({'error': 'event_id required'}, status=status.HTTP_400_BAD_REQUEST)

        event = Event.objects.filter(id=event_uuid).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        if not can_invite_guests(event, request.user):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        if not isinstance(guests_data, list) or not guests_data:
            return Response({'error': 'guests must be a non-empty list'}, status=status.HTTP_400_BAD_REQUEST)

        created = []
        errors = []
        with transaction.atomic():
            for guest_data in guests_data:
                name = (guest_data.get('name') or '').strip()
                email = (guest_data.get('email') or '').strip()
                if not name or not email:
                    errors.append({'email': email, 'error': 'name and email are required'})
                    continue
                if event.max_guests and Guest.objects.filter(event=event).count() >= event.max_guests:
                    errors.append({'email': email, 'error': 'Event at capacity'})
                    continue
                try:
                    guest, was_created = Guest.objects.get_or_create(
                        event=event,
                        normalized_email=email.lower(),
                        defaults={'name': name, 'email': email},
                    )
                except Exception as exc:
                    errors.append({'email': email, 'error': str(exc)})
                    continue
                created.append(
                    {'id': str(guest.id), 'email': guest.email, 'created': was_created}
                )

        return Response(
            {'created': len(created), 'errors': len(errors), 'guests': created},
            status=status.HTTP_201_CREATED,
        )


class UpdateRSVPView(SessionAuthMixin, APIView):
    """POST /api/guests/:id/rsvp — record an answer."""

    def post(self, request, guest_id):
        guest = Guest.objects.select_related('event').filter(id=guest_id).first()
        if guest is None:
            return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)

        if not (
            can_manage_guests(guest.event, request.user)
            or is_own_guest_record(guest, request.user)
        ):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        new_status = request.data.get('status') or request.data.get('rsvp_status')
        if new_status not in RSVP_STATUSES:
            return Response({'error': 'Invalid RSVP status'}, status=status.HTTP_400_BAD_REQUEST)

        if new_status in ('accepted', 'confirmed') and guest.event.max_guests:
            accepted_count = (
                Guest.objects.filter(
                    event=guest.event, rsvp_status__in=['accepted', 'confirmed']
                )
                .exclude(id=guest.id)
                .count()
            )
            if accepted_count >= guest.event.max_guests:
                return Response({'error': 'Event at capacity'}, status=status.HTTP_400_BAD_REQUEST)

        guest.rsvp_status = new_status
        guest.rsvp_responded_at = timezone.now()
        guest.revision += 1
        guest.save()
        return Response(_guest_payload(guest))


class CheckInGuestView(SessionAuthMixin, APIView):
    """POST /api/guests/:id/check-in — host-only door check-in."""

    def post(self, request, guest_id):
        guest = Guest.objects.select_related('event').filter(id=guest_id).first()
        if guest is None:
            return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)
        if not can_manage_guests(guest.event, request.user):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        guest.checked_in = True
        guest.is_checked_in = True
        guest.checked_in_at = timezone.now()
        guest.revision += 1
        guest.save()
        return Response(_guest_payload(guest))
