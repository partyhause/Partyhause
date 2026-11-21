from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class PollListView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({'polls': []})

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({}, status=status.HTTP_201_CREATED)


class PollDetailView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request, poll_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({})


class PollVoteView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def post(self, request, poll_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({})


class PollCloseView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def post(self, request, poll_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({})
