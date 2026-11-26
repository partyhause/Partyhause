from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin

from .models import Subscription

FREE_AI_TURNS = 3
CARD_TRIAL_DAYS = 14
MS_PER_DAY = 24 * 60 * 60 * 1000


def _is_future(at, now):
    if not at:
        return False
    time = at.timestamp() * 1000
    return time > now.timestamp() * 1000


def _days_remaining(at, now):
    if not at:
        return None
    delta = at.timestamp() * 1000 - now.timestamp() * 1000
    if delta <= 0:
        return 0
    return max(0, int(delta // MS_PER_DAY))


def _paywall_reason(facts, status):
    if facts.get('first_paid_at') is not None:
        return 'subscription_lapsed'
    if facts.get('card_trial_started_at') is not None:
        return 'subscription_required'
    return 'free_quota_exhausted'


def _load_facts(user):
    sub = Subscription.objects.filter(user=user).first()
    if sub is None:
        return {
            'plan': 'free',
            'status': 'none',
            'source': 'none',
            'card_trial_started_at': None,
            'trial_ends_at': None,
            'current_period_end': None,
            'cancel_at_period_end': False,
            'first_paid_at': None,
        }
    return {
        'plan': sub.plan,
        'status': sub.status,
        'source': sub.source,
        'card_trial_started_at': sub.card_trial_started_at,
        'trial_ends_at': sub.trial_ends_at,
        'current_period_end': sub.current_period_end,
        'cancel_at_period_end': sub.cancel_at_period_end,
        'first_paid_at': sub.first_paid_at,
    }


def _compute_entitlement(facts, billable_ai_turns, now):
    status = facts['status']
    in_paid_period = status == 'past_due' and _is_future(facts['current_period_end'], now)
    in_trial = status == 'trialing' and _is_future(facts['trial_ends_at'], now)
    is_entitled = status == 'active' or in_trial or in_paid_period

    used = max(0, billable_ai_turns)
    remaining = max(0, FREE_AI_TURNS - used)
    can_use_ai = is_entitled or remaining > 0

    can_start_card = (
        facts['card_trial_started_at'] is None and status != 'active'
    )

    trial_ends_at = (
        facts['trial_ends_at'].isoformat() if in_trial and facts['trial_ends_at'] else None
    )
    trial_days = _days_remaining(facts['trial_ends_at'], now) if in_trial else None

    return {
        'plan': facts['plan'],
        'status': status,
        'source': facts['source'],
        'is_entitled': is_entitled,
        'can_use_ai': can_use_ai,
        'trial_ends_at': trial_ends_at,
        'trial_days_remaining': trial_days,
        'cancel_at_period_end': facts['cancel_at_period_end'],
        'ai': {'used': used, 'limit': FREE_AI_TURNS, 'remaining': remaining},
        'paywall': {
            'show': not can_use_ai,
            'reason': _paywall_reason(facts, status) if not can_use_ai else None,
        },
        'can_start': {'card_14d': can_start_card},
    }


class EntitlementView(SessionAuthMixin, APIView):
    """GET /api/billing/entitlement — current entitlement projection."""

    def get(self, request):
        facts = _load_facts(request.user)
        billable_turns = 0
        try:
            from ai_chat.models import AiUsage
            billable_turns = AiUsage.objects.filter(
                user=request.user, source='llm'
            ).count()
        except ImportError:
            pass

        now = timezone.now()
        view = _compute_entitlement(facts, billable_turns, now)
        return Response(view)


class TrialStartView(SessionAuthMixin, APIView):
    """POST /api/billing/trial/start — start the card-on-file trial."""

    def post(self, request):
        user = request.user
        now = timezone.now()

        with transaction.atomic():
            locked = Subscription.objects.select_for_update().filter(user=user).first()

            if locked and locked.status == 'active':
                return Response(
                    {'error': 'This account already has an active subscription.', 'code': 'ALREADY_SUBSCRIBED'},
                    status=status.HTTP_409_CONFLICT,
                )

            if locked and locked.card_trial_started_at is not None:
                still_running = (
                    locked.status == 'trialing'
                    and locked.trial_ends_at is not None
                    and locked.trial_ends_at > now
                )
                if still_running:
                    return Response(
                        {
                            'trial_ends_at': locked.trial_ends_at.isoformat(),
                            'already_running': True,
                            'entitlement': _compute_entitlement(
                                _load_facts(user), 0, now
                            ),
                        },
                        status=status.HTTP_200_OK,
                    )
                return Response(
                    {
                        'error': f'This account has already used its {CARD_TRIAL_DAYS}-day trial.',
                        'code': 'TRIAL_ALREADY_USED',
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            ends_at = now + timedelta(days=CARD_TRIAL_DAYS)
            data = {
                'plan': 'creator',
                'status': 'trialing',
                'card_trial_started_at': now,
                'trial_ends_at': ends_at,
            }

            if locked:
                for k, v in data.items():
                    setattr(locked, k, v)
                locked.save(update_fields=list(data.keys()) + ['updated_at'])
            else:
                locked = Subscription.objects.create(user=user, source='none', **data)

        billable_turns = 0
        try:
            from ai_chat.models import AiUsage
            billable_turns = AiUsage.objects.filter(user=user, source='llm').count()
        except ImportError:
            pass

        return Response(
            {
                'trial_ends_at': ends_at.isoformat(),
                'already_running': False,
                'entitlement': _compute_entitlement(_load_facts(user), billable_turns, now),
            },
            status=status.HTTP_201_CREATED,
        )