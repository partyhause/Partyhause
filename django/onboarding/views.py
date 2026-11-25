from rest_framework.views import APIView
from rest_framework.response import Response
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class OnboardingView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        user = request.user
        consent, _ = user.agentic_consent.get_or_create(user=user)
        return Response({
            'step': 1,
            'answers': {},
            'onboarding_required': bool(getattr(user, 'onboarding_required', False)),
            'agentic_consent': {
                'enabled': consent.enabled,
                'llm_provider': consent.llm_provider,
            },
            'show_agentic_step': True,
        })
