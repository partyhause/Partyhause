from rest_framework.views import APIView
from rest_framework.response import Response
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

ONBOARDING_SCHEMA_VERSION = '2026-09-13'

ONBOARDING_STEPS = [
    'chat',
    'who_you_are',
    'ai_lifecycle',
    'paywall',
    'autonomy',
]


class OnboardingView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        user = request.user

        # The funnel is derived server-side so both clients agree on which
        # screen is next. With no stored answers yet, every step is incomplete
        # and unlocked, and the user starts on screen one.
        flow = {
            'schema_version': ONBOARDING_SCHEMA_VERSION,
            'steps': [
                {'id': step_id, 'position': position, 'complete': False, 'locked': False}
                for position, step_id in enumerate(ONBOARDING_STEPS, start=1)
            ],
            'current_step': 'chat',
            'completed': False,
            'blocked_by_paywall': False,
        }

        # Empty answer set: nothing answered yet. Every field nullable/absent
        # matches the shared contract; the client treats missing keys as "not
        # answered" rather than crashing.
        answers = {
            'organizer_type': None,
            'events_per_year': None,
            'typical_guest_count': None,
            'ai_before': [],
            'ai_during': [],
            'ai_after': [],
            'autonomy_level': None,
            'agentic_wants': [],
            'biggest_pain': None,
            'event_interests': [],
            'marketing_opt_in': False,
            'completed_at': None,
        }

        # Free-tier entitlement: no AI quota, no trial, no paywall shown yet.
        entitlement = {
            'plan': 'free',
            'status': 'none',
            'is_entitled': False,
            'can_use_ai': False,
            'trial_ends_at': None,
            'trial_days_remaining': None,
            'paywall': {'show': False, 'reason': None},
            'can_start': {'card_14d': False},
            'ai': {'used': 0, 'limit': 0, 'remaining': 0},
        }

        return Response({
            'flow': flow,
            'answers': answers,
            'entitlement': entitlement,
        })
