from rest_framework.views import APIView
from rest_framework.response import Response
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class TimelineListView(SessionAuthMixin, APIView):
    """GET /api/timeline/:eventId — Timeline blocks (stub)"""
    REQUIRES_VERIFIED = True

    def get(self, request, event_id):
        return Response({'timeline': []})


class TimelineCreateView(SessionAuthMixin, APIView):
    """POST /api/timeline — Create timeline block (stub)"""
    REQUIRES_VERIFIED = True

    def post(self, request):
        return Response({'block': {}})


class TimelineUpdateView(SessionAuthMixin, APIView):
    """PUT /api/timeline/:id — Update timeline block (stub)"""
    REQUIRES_VERIFIED = True

    def put(self, request, id):
        return Response({'block': {}})


class TimelineDeleteView(SessionAuthMixin, APIView):
    """DELETE /api/timeline/:id — Delete timeline block (stub)"""
    REQUIRES_VERIFIED = True

    def delete(self, request, id):
        return Response({'deleted': True})
