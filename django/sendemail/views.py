from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class SendEmailView(SessionAuthMixin, APIView):
    """POST /api/send-email — Send email (stub)"""
    REQUIRES_VERIFIED = True

    def post(self, request):
        return Response({'sent': True}, status=status.HTTP_200_OK)
