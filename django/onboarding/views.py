import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin

from .models import OnboardingResponse

ONBOARDING_SCHEMA_VERSION = '2026-09-13'

ONBOARDING_STEPS = [
    ('chat', 1),
    ('who_you_are', 2),
    ('ai_lifecycle', 3),
    ('paywall', 4),
    ('autonomy', 5),
]

STEP_FIELDS = {
    'chat': [],
    'who_you_are': ['organizer_type', 'events_per_year', 'typical_guest_count'],
    'ai_lifecycle': ['ai_before', 'ai_during', 'ai_after'],
    'paywall': ['marketing_opt_in'],
    'autonomy': ['autonomy_level', 'agentic_wants', 'biggest_pain', 'event_interests'],
}


def _step_complete(answers, step):
    for field in STEP_FIELDS.get(step, []):
        value = answers.get(field)
        if value is None:
            return False
        if isinstance(value, (list, tuple)) and len(value) == 0:
            return False
        if isinstance(value, str) and value == '':
            return False
    return True


def _flow_from_answers(answers, entitlement):
    steps = []
    for step, pos in ONBOARDING_STEPS:
        complete = _step_complete(answers, step)
        locked = False
        if step == 'paywall' and not entitlement.get('is_entitled', False):
            locked = entitlement.get('paywall', {}).get('show', False)
        elif step == 'autonomy' and not entitlement.get('is_entitled', False):
            locked = True
        steps.append(
            {
                'id': step,
                'position': pos,
                'complete': complete,
                'locked': locked,
            }
        )

    current = None
    for step in steps:
        if not step['complete']:
            current = step['id']
            break

    completed = all(s['complete'] for s in steps)
    if completed:
        current = None

    blocked_by_paywall = not entitlement.get('is_entitled', False) and entitlement.get(
        'paywall', {}
    ).get('show', False)

    return {
        'schema_version': ONBOARDING_SCHEMA_VERSION,
        'steps': steps,
        'current_step': current,
        'completed': completed,
        'blocked_by_paywall': blocked_by_paywall,
    }


def _load_answers(user):
    try:
        return OnboardingResponse.objects.get(user=user)
    except OnboardingResponse.DoesNotExist:
        return None


def _answers_dict(obj):
    if obj is None:
        return {}
    return obj.responses or {}


def _entitlement(user):
    try:
        from billing.views import _load_facts, _compute_entitlement
        facts = _load_facts(user)
        billable = 0
        try:
            from ai_chat.models import AiUsage
            billable = AiUsage.objects.filter(user=user, source='llm').count()
        except ImportError:
            pass
        return _compute_entitlement(facts, billable, timezone.now())
    except ImportError:
        return {
            'plan': 'free',
            'status': 'none',
            'source': 'none',
            'is_entitled': False,
            'can_use_ai': False,
            'trial_ends_at': None,
            'trial_days_remaining': None,
            'cancel_at_period_end': False,
            'ai': {'used': 0, 'limit': 0, 'remaining': 0},
            'paywall': {'show': False, 'reason': None},
            'can_start': {'card_14d': False},
        }


class OnboardingView(SessionAuthMixin, APIView):
    """GET/PATCH /api/onboarding/ — funnel state and answer persistence."""

    def get(self, request):
        obj = _load_answers(request.user)
        answers = _answers_dict(obj)
        ent = _entitlement(request.user)
        flow = _flow_from_answers(answers, ent)
        return Response(
            {
                'flow': flow,
                'answers': {
                    'organizer_type': answers.get('organizer_type'),
                    'events_per_year': answers.get('events_per_year'),
                    'typical_guest_count': answers.get('typical_guest_count'),
                    'ai_before': answers.get('ai_before', []),
                    'ai_during': answers.get('ai_during', []),
                    'ai_after': answers.get('ai_after', []),
                    'autonomy_level': answers.get('autonomy_level'),
                    'agentic_wants': answers.get('agentic_wants', []),
                    'biggest_pain': answers.get('biggest_pain'),
                    'event_interests': answers.get('event_interests', []),
                    'marketing_opt_in': answers.get('marketing_opt_in', False),
                    'completed_at': (
                        obj.completed_at.isoformat() if obj and obj.completed_at else None
                    ),
                },
                'entitlement': ent,
            }
        )

    def patch(self, request):
        data = request.data
        if not isinstance(data, dict):
            return Response(
                {'error': 'Request body must be an object'}, status=status.HTTP_400_BAD_REQUEST
            )

        allowed = {
            'organizer_type',
            'events_per_year',
            'typical_guest_count',
            'ai_before',
            'ai_during',
            'ai_after',
            'autonomy_level',
            'agentic_wants',
            'biggest_pain',
            'event_interests',
            'marketing_opt_in',
            'completed',
        }
        incoming = {k: v for k, v in data.items() if k in allowed}

        with transaction.atomic():
            obj, _ = OnboardingResponse.objects.select_for_update().get_or_create(
                user=request.user, defaults={'responses': {}}
            )
            if obj.responses is None:
                obj.responses = {}
            obj.responses.update(incoming)
            if data.get('completed') is True and obj.completed_at is None:
                obj.completed_at = timezone.now()
            obj.save()

        answers = obj.responses
        ent = _entitlement(request.user)
        flow = _flow_from_answers(answers, ent)
        return Response(
            {
                'flow': flow,
                'answers': {
                    'organizer_type': answers.get('organizer_type'),
                    'events_per_year': answers.get('events_per_year'),
                    'typical_guest_count': answers.get('typical_guest_count'),
                    'ai_before': answers.get('ai_before', []),
                    'ai_during': answers.get('ai_during', []),
                    'ai_after': answers.get('ai_after', []),
                    'autonomy_level': answers.get('autonomy_level'),
                    'agentic_wants': answers.get('agentic_wants', []),
                    'biggest_pain': answers.get('biggest_pain'),
                    'event_interests': answers.get('event_interests', []),
                    'marketing_opt_in': answers.get('marketing_opt_in', False),
                    'completed_at': (
                        obj.completed_at.isoformat() if obj.completed_at else None
                    ),
                },
                'entitlement': ent,
            }
        )