from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q
from event_templates.models import EventTemplate
from event_templates.serializers import EventTemplateSerializer
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

class PartyPlateListView(SessionAuthMixin, APIView):
    """GET /api/partyplates/ — list system and user partyplates."""
    def get(self, request):
        user = request.user
        system_qs = EventTemplate.objects.filter(author_id__isnull=True, published=True)
        user_qs = EventTemplate.objects.filter(author_id=user.id) if user.is_authenticated else EventTemplate.objects.none()
        system_ser = EventTemplateSerializer(system_qs, many=True)
        user_ser = EventTemplateSerializer(user_qs, many=True)
        return Response({
            'system': system_ser.data,
            'mine': user_ser.data
        })

class PartyPlateCreateView(SessionAuthMixin, APIView):
    """POST /api/partyplates/create/ — save user partyplate from event payload."""
    def post(self, request):
        user = request.user
        name = request.data.get('name')
        payload = request.data.get('default_payload', {})
        if not name:
            return Response({'error': 'name required'}, status=status.HTTP_400_BAD_REQUEST)
        tmpl = EventTemplate.objects.create(
            name=name,
            slug=f"user_{user.id}_{name.lower().replace(' ', '_')}",
            description=request.data.get('description', ''),
            category=request.data.get('category', 'other'),
            hero_image_url=request.data.get('hero_image_url', ''),
            price_tier='free',
            default_payload=payload,
            author_id=user.id,
            featured=False,
            published=False
        )
        ser = EventTemplateSerializer(tmpl)
        return Response(ser.data, status=status.HTTP_201_CREATED)
