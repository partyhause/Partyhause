from rest_framework.views import APIView
from rest_framework.response import Response
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class TrialStartView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({'success': True})
