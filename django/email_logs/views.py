from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class EmailLogListView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({'logs': []})

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({}, status=status.HTTP_201_CREATED)


class EmailLogDetailView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def put(self, request, log_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({})
