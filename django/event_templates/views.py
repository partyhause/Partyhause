from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.exceptions import NotFound, PermissionDenied
from django.utils import timezone
from datetime import datetime
from datetime import timedelta
import uuid

from .models import EventTemplate
from .serializers import EventTemplateSerializer
from events.models import Event
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


def _get_template_or_404(template_id):
    """Fetch a template by ID. Listing/detail are public; ownership is only
    enforced for mutating operations (PUT/DELETE) and create-event."""
    try:
        return EventTemplate.objects.get(id=template_id)
    except EventTemplate.DoesNotExist:
        raise NotFound('Template not found')


def _require_ownership(template, user):
    """Callers must pass an authenticated user; raises 403 if not the author."""
    if not user or not user.is_authenticated:
        raise PermissionDenied('Authentication required')
    if template.author_id != user.id:
        raise PermissionDenied('You do not own this template')


def deep_merge(target: dict, source: dict) -> dict:
    """Deep merge source into target, returning a new dict."""
    output = dict(target)
    for key, value in source.items():
        if key in output and isinstance(output[key], dict) and isinstance(value, dict):
            output[key] = deep_merge(output[key], value)
        else:
            output[key] = value
    return output


class EventTemplateListView(SessionAuthMixin, APIView):
    """GET /api/event-templates/ — List templates.

    Returns public system templates plus the authenticated user's own
    templates (published or not), annotated with ``source`` so the client
    can render them as "Discover" vs "Mine".
    """

    ALLOW_ANONYMOUS = True

    def get(self, request):
        user = request.user

        try:
            system_qs = EventTemplate.objects.filter(author_id__isnull=True, published=True)
            user_qs = (
                EventTemplate.objects.filter(author_id=user.id).order_by('-created_at')
                if user and user.is_authenticated
                else EventTemplate.objects.none()
            )
        except Exception:
            # Table may not exist yet (migration not applied). Return empty
            # lists so the frontend does not crash.
            system_qs = EventTemplate.objects.none()
            user_qs = EventTemplate.objects.none()

        system_ser = EventTemplateSerializer(system_qs, many=True)
        user_ser = EventTemplateSerializer(user_qs, many=True)

        # Annotate source so the client can split Discover / Mine.
        for item in system_ser.data:
            item['source'] = 'system'
        for item in user_ser.data:
            item['source'] = 'user'

        return Response({
            'system': system_ser.data,
            'mine': user_ser.data,
            'templates': system_ser.data + user_ser.data,
        })

    def post(self, request):
        """Create a new template owned by the authenticated user."""
        serializer = EventTemplateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        slug = serializer.validated_data.get('slug') or ''
        if not slug:
            base = (serializer.validated_data.get('name') or 'template').lower()
            slug = f"user_{request.user.id}_{base}".replace(' ', '_')
        if EventTemplate.objects.filter(slug=slug).exists():
            slug = f"{slug}-{uuid.uuid4().hex[:8]}"

        try:
            template = serializer.save(
                author=request.user,
                slug=slug,
                published=False,
            )
        except Exception:
            return Response(
                {'error': 'Could not create the template'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            EventTemplateSerializer(template).data,
            status=status.HTTP_201_CREATED,
        )


class EventTemplateDetailView(SessionAuthMixin, APIView):
    """GET/PUT/DELETE /api/event-templates/:id/ — Template details.

    GET is public (mirrors Express). PUT/DELETE require ownership.
    """

    ALLOW_ANONYMOUS = True

    def get(self, request, template_id):
        try:
            template = EventTemplate.objects.get(id=template_id)
        except EventTemplate.DoesNotExist:
            raise NotFound('Template not found')
        serializer = EventTemplateSerializer(template)
        return Response(serializer.data)

    def put(self, request, template_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        template = _get_template_or_404(template_id)
        _require_ownership(template, request.user)
        serializer = EventTemplateSerializer(template, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, template_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        template = _get_template_or_404(template_id)
        _require_ownership(template, request.user)
        template.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EventTemplateUseView(SessionAuthMixin, APIView):
    """POST /api/event-templates/:id/use/ — Track template usage.

    Mirrors Express: usage is tracked inside create-event, but the frontend
    also calls /use/ on selection. Any authenticated user may increment usage;
    no ownership check (Express has no such restriction).
    """

    REQUIRES_VERIFIED = True

    def post(self, request, template_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        try:
            template = EventTemplate.objects.get(id=template_id)
        except EventTemplate.DoesNotExist:
            raise NotFound('Template not found')
        template.usage_count += 1
        template.save(update_fields=['usage_count', 'updated_at'])
        return Response({
            'usage_count': template.usage_count,
        })


class EventTemplateCreateEventView(SessionAuthMixin, APIView):
    """POST /api/event-templates/:id/create-event/ — Create an event from a template.

    Mirrors Express: requireAuth only (no ownership check on the template).
    Deep-merges template.default_payload with user overrides, writes
    template_type/template_data onto the event row, tracks usage, and returns
    the event id/name so the frontend can navigate and toast.
    """

    REQUIRES_VERIFIED = True

    def post(self, request, template_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        template = _get_template_or_404(template_id)

        try:
            overrides = request.data or {}
        except Exception:
            overrides = {}

        # Deep merge template.default_payload with overrides
        payload = deep_merge(template.default_payload or {}, overrides)

        # Ensure required event fields
        event_payload = payload.get('event', {})
        if not event_payload.get('start_date'):
            return Response({'error': 'Event start_date is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not event_payload.get('name'):
            return Response({'error': 'Event name is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Compute end_date from duration_hours when not explicitly overridden
        end_date = event_payload.get('end_date')
        if not end_date and event_payload.get('duration_hours'):
            start = event_payload.get('start_date')
            try:
                start_dt = datetime.fromisoformat(start.replace('Z', '+00:00') if isinstance(start, str) else start.isoformat())
                end_date = (start_dt + timedelta(hours=float(event_payload['duration_hours']))).isoformat()
            except Exception:
                end_date = start

        # Build the Event from the merged payload
        event = Event.objects.create(
            host_id=request.user.id,
            name=event_payload.get('name') or template.name,
            title=event_payload.get('title') or event_payload.get('name') or template.name,
            description=event_payload.get('description'),
            start_date=event_payload.get('start_date'),
            end_date=end_date or event_payload.get('start_date'),
            location=event_payload.get('location', ''),
            location_name=event_payload.get('location_name'),
            privacy=event_payload.get('privacy', 'private'),
            status=event_payload.get('status', 'draft'),
            max_guests=event_payload.get('max_guests', 50),
            is_public=event_payload.get('is_public', False),
            template_type=template.category,
            template_data=payload,
        )

        template.usage_count += 1
        template.save(update_fields=['usage_count', 'updated_at'])

        return Response({
            'id': str(event.id),
            'name': event.name,
            'template_used': template.id,
        }, status=status.HTTP_201_CREATED)
