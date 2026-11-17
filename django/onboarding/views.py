from rest_framework.views import APIView
from rest_framework.response import Response
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class OnboardingView(SessionAuthMixin, APIView):
    """
    Session/state contract matching Express server/routes/onboarding.ts:

    - missing/invalid/expired/revoked token -> 401 SESSION_REVOKED (wipe session)
    - valid token but unverified email      -> 403 EMAIL_NOT_VERIFIED (preserve session)
    - valid + verified                      -> 200 with onboarding state
    """

    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        # Onboarding funnel state: Express returns which step, what's been
        # answered, and whether the wall is in the way. Return minimal shape
        # the client can build on.
        return Response({
            'step': 1,
            'answers': {},
            'onboarding_required': bool(getattr(request.user, 'onboarding_required', False)),
        })
