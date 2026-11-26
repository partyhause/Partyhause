import uuid
from datetime import datetime, timedelta, timezone as dt_timezone

from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin

try:
    from azure.messaging.webpubsubservice import WebPubSubServiceClient
except ImportError:  # pragma: no cover - production installs requirements.txt
    WebPubSubServiceClient = None


def _service():
    if WebPubSubServiceClient is None:
        return None
    connection_string = getattr(settings, 'WEBPUBSUB_CONNECTION_STRING', '')
    if not connection_string:
        return None
    return WebPubSubServiceClient.from_connection_string(
        connection_string, hub=getattr(settings, 'WEBPUBSUB_HUB', 'partyhause')
    )


class NegotiateView(SessionAuthMixin, APIView):
    """GET /api/realtime/negotiate — obtain a Web PubSub client access URL."""

    def get(self, request):
        service = _service()
        if service is None:
            return Response(
                {'configured': False, 'url': None},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        user_id = str(request.user.id)
        # TTL 60 minutes, matching the Express implementation.
        expires_at = datetime.now(dt_timezone.utc) + timedelta(minutes=60)

        try:
            token = service.get_client_access_token(
                user_id=user_id,
                roles=[f'webpubsub.joinLeaveGroup.{user_id}'],
                expires_at=expires_at,
            )
            # The token.url is the full WebSocket URL including the access token.
            return Response({'configured': True, 'url': token.url})
        except Exception:
            return Response(
                {'configured': False, 'url': None, 'error': 'Failed to obtain token'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )