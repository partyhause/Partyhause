from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.utils import timezone
from .models import Event
from accounts.models import User
from guests.models import Guest
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class EventAccess:
    """Replicate Express getEventAccess logic"""

    def __init__(self, event, user):
        self.event = event
        self.user = user
        if not event:
            self.exists = False
            return

        self.is_host = str(event.host_id) == str(user.id) if user else False
        self.is_public = event.is_public or event.privacy == 'public'

        # Check if user is guest via email match
        is_guest = False
        if user and user.email:
            try:
                guest = Guest.objects.filter(event=event, email__iexact=user.email).first()
                is_guest = guest is not None
            except Exception:
                pass

        self.is_guest = is_guest
        self.exists = True
        self.host_id = event.host_id

    def can_read(self):
        return self.exists and (self.is_public or self.is_host or self.is_guest)

    def can_edit(self):
        return self.exists and self.is_host

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
        'location': event.location,
        'location_name': event.location_name,
        'privacy': event.privacy,
        'status': event.status,
        'max_guests': event.max_guests,
        'is_public': event.is_public,
        'host_id': str(event.host_id),
        'created_at': event.created_at.isoformat(),
        'updated_at': event.updated_at.isoformat(),
    }
    can_edit = access.can_edit() if access else False
    if can_edit:
        base['capabilities'] = {
            'can_edit': can_edit,
            'can_delete': access.can_delete() if access else False,
            'can_view_insights': True
        }
    return base


class IndexEventsView(APIView):
    """GET /api/events/ — List events user can see"""
    permission_classes = [AllowAny]

    def get(self, request):
        user = request.user if request.user.is_authenticated else None
        if not user:
            return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

        # List user's hosted events
        events = Event.objects.filter(host_id=user.id)

        # Add guest events
        if user.email:
            from guests.models import Guest as GuestModel
            guest_event_ids = GuestModel.objects.filter(email__iexact=user.email).values_list('event_id', flat=True)
            events = events | Event.objects.filter(id__in=guest_event_ids)

        events = events.distinct().order_by('start_date')

        data = []
        for e in events:
            ea = EventAccess(e, user)
            data.append(serialize_event(e, ea))

        return Response({'events': data, 'count': len(data)})

    def post(self, request):
        """POST /api/events/ — Create event"""
        if not request.user or not request.user.is_authenticated:
            return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            data = request.data
            event = Event.objects.create(
                host_id=request.user.id,
                name=data.get('name'),
                title=data.get('title') or data.get('name'),
                description=data.get('description'),
                start_date=data.get('start_date'),
                end_date=data.get('end_date'),
                location=data.get('location'),
                location_name=data.get('location_name'),
                privacy=data.get('privacy', 'private'),
                status=data.get('status', 'draft'),
                max_guests=data.get('max_guests', 50),
                is_public=data.get('is_public', False),
                template_type=data.get('template_type'),
                template_data=data.get('template_data', {}),
                timeline_blocks=data.get('timeline_blocks', []),
            )
            return Response({'id': str(event.id), 'status': 'created'}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class GetEventView(APIView):
    """GET /api/events/:id — Get single event"""
    permission_classes = [AllowAny]

    def get(self, request, event_id):
        try:
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            access = EventAccess(event, request.user)
            if not access.can_read():
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            # Get stats
            guests = Guest.objects.filter(event=event)
            stats = {
                'total_guests': guests.count(),
                'guests_accepted': guests.filter(rsvp_status__in=['accepted', 'confirmed']).count(),
                'guests_declined': guests.filter(rsvp_status='declined').count(),
                'guests_pending': guests.filter(rsvp_status='pending').count(),
                'guests_checked_in': guests.filter(checked_in=True).count(),
            }

            serialised = serialize_event(event, {'can_view_insights': access.can_edit()})

            response = {'event': serialised}
            if serialised.get('capabilities', {}).get('can_edit'):
                response['stats'] = stats

            return Response(response)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def delete(self, request, event_id):
        """DELETE /api/events/:id — Delete event (host only)"""
        try:
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            access = EventAccess(event, request.user)
            if not access.can_delete():
                return Response({'error': 'Only the host can delete this event'}, status=status.HTTP_403_FORBIDDEN)

            event.delete()
            return Response({'status': 'deleted'}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



class CreateEventView(SessionAuthMixin, APIView):
    """POST /api/events/ — Create event"""
    REQUIRES_VERIFIED = True

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        try:
            data = request.data
            event = Event.objects.create(
                host_id=request.user.id,
                name=data.get('name'),
                title=data.get('title') or data.get('name'),
                description=data.get('description'),
                start_date=data.get('start_date'),
                end_date=data.get('end_date'),
                location=data.get('location'),
                location_name=data.get('location_name'),
                privacy=data.get('privacy', 'private'),
                status=data.get('status', 'draft'),
                max_guests=data.get('max_guests', 50),
                is_public=data.get('is_public', False),
                template_type=data.get('template_type'),
                template_data=data.get('template_data', {}),
            )
            return Response({'id': str(event.id), 'status': 'created'}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class UpdateEventView(APIView):
    """PUT /api/events/:id — Update event"""
    permission_classes = [AllowAny]

    def put(self, request, event_id):
        try:
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            access = EventAccess(event, request.user)
            if not access.can_edit():
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            data = request.data
            for field in ['name', 'title', 'description', 'location', 'location_name', 'privacy', 'status', 'max_guests', 'is_public']:
                if field in data:
                    setattr(event, field, data[field])
            event.save()
            return Response({'id': str(event.id), 'status': 'updated'})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class DeleteEventView(APIView):
    """DELETE /api/events/:id — Delete event"""
    permission_classes = [AllowAny]

    def delete(self, request, event_id):
        try:
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            access = EventAccess(event, request.user)
            if not access.can_delete():
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            event.delete()
            return Response({'status': 'deleted'})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class PublishEventView(APIView):
    """POST /api/events/:id/publish — Publish event"""
    permission_classes = [AllowAny]

    def post(self, request, event_id):
        try:
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            access = EventAccess(event, request.user)
            if not access.can_edit():
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            # Validation
            if not event.name or not event.start_date or not event.location:
                return Response({'error': 'Name, start date, and location required'}, status=status.HTTP_400_BAD_REQUEST)

            if event.start_date <= timezone.now():
                return Response({'error': 'Cannot publish past event'}, status=status.HTTP_400_BAD_REQUEST)

            event.status = 'published'
            event.published_at = timezone.now()
            event.save()

            return Response({'id': str(event.id), 'status': event.status})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class TimelineCreateView(SessionAuthMixin, APIView):
    """POST /api/events/:id/timeline — Create a timeline block"""
    REQUIRES_VERIFIED = True

    def post(self, request, event_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        try:
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({"error": "Event not found"}, status=status.HTTP_404_NOT_FOUND)

            access = EventAccess(event, request.user)
            if not access.can_edit():
                return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

            # Extract timeline block data from request
            data = request.data
            block = {
                "label": data.get("label"),
                "start_time": data.get("startTime"),
                "duration": data.get("duration"),
            }
            return Response({"block": block, "event_id": str(event.id)}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
