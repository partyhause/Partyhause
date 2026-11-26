from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin
from event_templates.models import EventTemplate
from event_templates.serializers import EventTemplateSerializer


class PartyPlateListView(SessionAuthMixin, APIView):
    """GET /api/partyplates/ — list system and user partyplates.

    System templates are public; the "mine" half is empty for an anonymous
    caller. `ALLOW_ANONYMOUS` makes that intent explicit, and every other view
    in this module is authenticated by `SessionAuthMixin.initial()`.
    """

    ALLOW_ANONYMOUS = True

    def get(self, request):
        user = request.user
        system_qs = EventTemplate.objects.filter(author_id__isnull=True, published=True)
        user_qs = (
            EventTemplate.objects.filter(author_id=user.id)
            if user and user.is_authenticated
            else EventTemplate.objects.none()
        )
        return Response({
            'system': EventTemplateSerializer(system_qs, many=True).data,
            'mine': EventTemplateSerializer(user_qs, many=True).data,
        })


class PartyPlateCreateView(SessionAuthMixin, APIView):
    """POST /api/partyplates/create/ — save a user partyplate."""

    def post(self, request):
        user = request.user
        name = request.data.get('name')
        payload = request.data.get('default_payload', {})
        if not name:
            return Response({'error': 'name required'}, status=status.HTTP_400_BAD_REQUEST)

        slug = f"user_{user.id}_{name.lower().replace(' ', '_')}"
        if EventTemplate.objects.filter(slug=slug).exists():
            return Response(
                {'error': 'A partyplate with that name already exists'},
                status=status.HTTP_409_CONFLICT,
            )

        template = EventTemplate.objects.create(
            name=name,
            slug=slug,
            description=request.data.get('description', ''),
            category=request.data.get('category', 'other'),
            hero_image_url=request.data.get('hero_image_url', ''),
            price_tier='free',
            default_payload=payload,
            author_id=user.id,
            featured=False,
            published=False,
        )
        return Response(
            EventTemplateSerializer(template).data,
            status=status.HTTP_201_CREATED,
        )
