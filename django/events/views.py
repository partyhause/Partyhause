import uuid
from datetime import datetime

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin
from guests.models import Guest

from .models import Event, EventCoHost

ALLOWED_STATUSES = {'draft', 'published', 'cancelled', 'completed', 'archived'}
EDITOR_ROLES = {'host', 'co-host', 'editor', 'organizer'}


class EventAccess:
    """What a viewer may do with an event.

    Co-hosts were previously ignored, so an event shared with a co-host was
    readable only by its owner. The role check is the same one the guest and
    invitation endpoints use.
    """

    def __init__(self, event, user):
        self.event = event
        self.user = user
        if not event:
            self.exists = False
            self.is_host = False
            self.is_co_host = False
            self.is_guest = False
            self.is_public = False
            self.host_id = None
            return

        authenticated = bool(user and getattr(user, 'is_authenticated', False))
        self.is_host = authenticated and str(event.host_id) == str(user.id)
        self.is_public = bool(event.is_public or event.privacy == 'public')

        self.is_co_host = False
        self.co_host_role = None
        if authenticated and not self.is_host:
            co_host = EventCoHost.objects.filter(event=event, user=user).first()
            if co_host is not None:
                self.is_co_host = True
                self.co_host_role = co_host.role

        is_guest = False
        if authenticated and user.email:
            is_guest = Guest.objects.filter(event=event, email__iexact=user.email).exists()
            if not is_guest:
                is_guest = Guest.objects.filter(event=event, user_id=user.id).exists()
        self.is_guest = is_guest
        self.exists = True
        self.host_id = event.host_id

    def can_read(self):
        return self.exists and (
            self.is_public or self.is_host or self.is_co_host or self.is_guest
        )

    def can_edit(self):
        if not self.exists:
            return False
        if self.is_host:
            return True
        return self.is_co_host and self.co_host_role in EDITOR_ROLES

    def can_delete(self):
        return self.exists and self.is_host


def serialize_event(event, access):
    base = {
        'id': str(event.id),
        'name': event.name,
        'title': event.title,
        'description': event.description,
        'start_date': event.start_date.isoformat() if event.start_date else None,
        'end_date': event.end_date.isoformat() if event.end_date else None,
        'event_date': event.event_date.isoformat() if event.event_date else None,
        'event_type': event.event_type,
        'location': event.location,
        'location_name': event.location_name,
        'location_address': event.location_address,
        'privacy': event.privacy,
        'status': event.status,
        'max_guests': event.max_guests,
        'is_public': event.is_public,
        'host_id': str(event.host_id),
        'revision': event.revision,
        'created_at': event.created_at.isoformat(),
        'updated_at': event.updated_at.isoformat(),
        'external_source': event.external_source,
        'external_event_id': event.external_event_id,
        'external_metadata': event.external_metadata,
        'capabilities': {
            'can_edit': access.can_edit() if access else False,
            'can_delete': access.can_delete() if access else False,
            'can_view_insights': access.can_edit() if access else False,
        },
    }
    return base


def _parse_datetime(value, field):
    if value in (None, ''):
        return None, None
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = parse_datetime(str(value))
        if parsed is None:
            date_only = parse_date(str(value))
            if date_only is not None:
                parsed = datetime.combine(date_only, datetime.min.time())
    if parsed is None:
        return None, f'{field} is not a valid ISO-8601 datetime'
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed, None


def _event_uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _create_event(request):
    data = request.data
    name = (data.get('name') or data.get('title') or '').strip()
    start_raw = data.get('start_date') or data.get('startDate') or data.get('date')
    end_raw = data.get('end_date') or data.get('endDate') or start_raw

    start_date, error = _parse_datetime(start_raw, 'start_date')
    if error:
        return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
    end_date, error = _parse_datetime(end_raw, 'end_date')
    if error:
        return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

    if not name or start_date is None:
        return Response(
            {'error': 'name and start_date are required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        max_guests = int(data.get('max_guests') or data.get('maxGuests') or 50)
    except (TypeError, ValueError):
        return Response({'error': 'max_guests must be a number'}, status=status.HTTP_400_BAD_REQUEST)

    event = Event.objects.create(
        host_id=request.user.id,
        name=name,
        title=data.get('title') or name,
        description=data.get('description'),
        start_date=start_date,
        end_date=end_date or start_date,
        event_date=start_date,
        location=data.get('location'),
        location_name=data.get('location_name') or data.get('locationName'),
        location_address=data.get('location_address') or data.get('locationAddress'),
        privacy=data.get('privacy', 'private'),
        status=data.get('status', 'draft'),
        max_guests=max_guests,
        is_public=bool(data.get('is_public') or data.get('isPublic')),
        template_type=data.get('template_type') or data.get('templateType'),
        template_data=data.get('template_data') or data.get('templateData') or {},
    )
    return Response(
        {
            'event': serialize_event(event, EventAccess(event, request.user)),
            'success': True,
        },
        status=status.HTTP_201_CREATED,
    )


def _update_event(request, event):
    data = request.data

    for source, target in (
        ('name', 'name'),
        ('title', 'title'),
        ('description', 'description'),
        ('location', 'location'),
        ('location_name', 'location_name'),
        ('locationName', 'location_name'),
        ('location_address', 'location_address'),
        ('locationAddress', 'location_address'),
        ('privacy', 'privacy'),
    ):
        if source in data:
            setattr(event, target, data[source])

    if 'max_guests' in data or 'maxGuests' in data:
        try:
            event.max_guests = int(data.get('max_guests') or data.get('maxGuests'))
        except (TypeError, ValueError):
            return Response({'error': 'max_guests must be a number'}, status=status.HTTP_400_BAD_REQUEST)

    if 'is_public' in data or 'isPublic' in data:
        event.is_public = bool(data.get('is_public') if 'is_public' in data else data.get('isPublic'))

    for source, target in (
        ('start_date', 'start_date'),
        ('startDate', 'start_date'),
        ('end_date', 'end_date'),
        ('endDate', 'end_date'),
        ('event_date', 'event_date'),
        ('eventDate', 'event_date'),
    ):
        if source in data:
            parsed, error = _parse_datetime(data[source], source)
            if error:
                return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
            if parsed is not None:
                setattr(event, target, parsed)

    requested_status = data.get('status')
    if requested_status is not None:
        if requested_status not in ALLOWED_STATUSES:
            return Response(
                {'error': f"status must be one of {sorted(ALLOWED_STATUSES)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if requested_status == 'published' and event.status != 'published':
            event.revision += 1
            event.save()
            try:
                event.publish()
            except ValueError as exc:
                return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        elif requested_status == 'cancelled' and event.status != 'cancelled':
            event.cancel()
        else:
            event.status = requested_status
            event.revision += 1
            event.save()
    else:
        event.revision += 1
        event.save()

    event.refresh_from_db()
    return Response(
        {
            'event': serialize_event(event, EventAccess(event, request.user)),
            'success': True,
        }
    )


class IndexEventsView(SessionAuthMixin, APIView):
    """GET/POST /api/events/ — list the caller's events or create one."""

    def get(self, request):
        user = request.user
        events = Event.objects.filter(host_id=user.id)

        events = events | Event.objects.filter(
            imported_by=user,
            external_source__isnull=False,
        ).exclude(external_source='')

        events = events | Event.objects.filter(co_hosts__user=user)

        if user.email:
            guest_event_ids = Guest.objects.filter(
                email__iexact=user.email
            ).values_list('event_id', flat=True)
            events = events | Event.objects.filter(id__in=guest_event_ids)

        events = events.distinct().order_by('start_date')
        data = [
            serialize_event(event, EventAccess(event, user))
            for event in events
        ]
        return Response({'events': data, 'count': len(data)})

    def post(self, request):
        return _create_event(request)


class CreateEventView(SessionAuthMixin, APIView):
    """POST /api/events/create/ — create an event."""

    def post(self, request):
        return _create_event(request)


class GetEventView(SessionAuthMixin, APIView):
    """GET/PUT/DELETE /api/events/:id/."""

    ALLOW_ANONYMOUS = True

    def get(self, request, event_id):
        event = Event.objects.filter(id=event_id).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(event, request.user)
        if not access.can_read():
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

        response = {'event': serialize_event(event, access)}
        if access.can_edit():
            guests = Guest.objects.filter(event=event)
            response['stats'] = {
                'total_guests': guests.count(),
                'guests_accepted': guests.filter(
                    rsvp_status__in=['accepted', 'confirmed']
                ).count(),
                'guests_declined': guests.filter(rsvp_status='declined').count(),
                'guests_pending': guests.filter(rsvp_status='pending').count(),
                'guests_checked_in': guests.filter(checked_in=True).count(),
            }
        return Response(response)

    def put(self, request, event_id):
        event = Event.objects.filter(id=event_id).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        return _update_event(request, event)

    def delete(self, request, event_id):
        event = Event.objects.filter(id=event_id).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(event, request.user)
        if not access.can_delete():
            return Response(
                {'error': 'Only the host can delete this event'},
                status=status.HTTP_403_FORBIDDEN,
            )
        event.delete()
        return Response({'status': 'deleted'})


class UpdateEventView(SessionAuthMixin, APIView):
    """PUT /api/events/:id/update/ — update an event."""

    def put(self, request, event_id):
        event = Event.objects.filter(id=event_id).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        return _update_event(request, event)


class DeleteEventView(SessionAuthMixin, APIView):
    """DELETE /api/events/:id/delete/ — delete an event (host only)."""

    def delete(self, request, event_id):
        event = Event.objects.filter(id=event_id).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(event, request.user)
        if not access.can_delete():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        event.delete()
        return Response({'status': 'deleted'})


class PublishEventView(SessionAuthMixin, APIView):
    """POST /api/events/:id/publish/ — publish a draft."""

    def post(self, request, event_id):
        event = Event.objects.filter(id=event_id).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        try:
            event.publish()
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                'event': serialize_event(event, access),
                'id': str(event.id),
                'status': event.status,
            }
        )
