from rest_framework.views import APIView
from rest_framework.response import Response
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class NegotiateView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({'url': ''})
