import uuid
import secrets
import string
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin

from .models import AccountDeletionRequest

RECEIPT_ALPHABET = string.ascii_letters + string.digits
RECEIPT_LENGTH = 24
INTENT_TTL_MINUTES = 15
ERASE_WINDOW_DAYS = 30


def _generate_receipt():
    return ''.join(secrets.choice(RECEIPT_ALPHABET) for _ in range(RECEIPT_LENGTH))


def _load_entitlement(user):
    from billing.views import _load_facts, _compute_entitlement
    facts = _load_facts(user)
    billable = 0
    try:
        from ai_chat.models import AiUsage
        billable = AiUsage.objects.filter(user=user, source='llm').count()
    except ImportError:
        pass
    return _compute_entitlement(facts, billable, timezone.now())


class AccountView(SessionAuthMixin, APIView):
    """GET /api/mvp/account/ — legal summary for the onboarding/paywall flow."""

    def get(self, request):
        user = request.user
        profile = getattr(user, 'profile', None)

        # Legal version constants - in production these come from settings/env
        terms_version = getattr(settings, 'CURRENT_TERMS_VERSION', '2026-09-01')
        privacy_version = getattr(settings, 'CURRENT_PRIVACY_VERSION', '2026-09-01')

        frontend_url = getattr(settings, 'FRONTEND_URL', 'https://partyhause.uk').rstrip('/')

        legal = {
            'termsVersion': terms_version,
            'privacyVersion': privacy_version,
            'effectiveDate': terms_version,
            'acceptedTermsVersion': user.terms_version,
            'acceptedPrivacyVersion': user.privacy_version,
            'ageEligible': user.age_eligible,
            'minimumAge': 18,
            'urls': {
                'privacy': f'{frontend_url}/privacy.html',
                'terms': f'{frontend_url}/terms.html',
                'support': f'{frontend_url}/support.html',
            },
        }

        account = {
            'id': str(user.id),
            'email': user.email,
            'name': user.name,
            'emailVerified': user.email_verified,
            'createdAt': user.created_at.isoformat(),
        }

        return Response({'account': account, 'legal': legal})


class DeletionIntentView(SessionAuthMixin, APIView):
    """POST /api/mvp/account/deletion-intent — request account deletion."""

    def post(self, request):
        user = request.user
        password = request.data.get('password')
        if not password:
            return Response(
                {'error': 'Password is required', 'code': 'PASSWORD_REQUIRED'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not user.check_password(password):
            return Response(
                {'error': 'Incorrect password', 'code': 'INVALID_PASSWORD'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        with transaction.atomic():
            # Invalidate any existing pending intent
            AccountDeletionRequest.objects.filter(
                user=user, status='pending'
            ).update(status='superseded')

            now = timezone.now()
            intent = AccountDeletionRequest.objects.create(
                user=user,
                receipt=_generate_receipt(),
                status='pending',
                confirmation_expires_at=now + timedelta(minutes=INTENT_TTL_MINUTES),
                erase_by=now + timedelta(days=ERASE_WINDOW_DAYS),
                retryable=True,
            )

        return Response(
            {
                'deletion': {
                    'receipt': intent.receipt,
                    'status': intent.status,
                    'requestedAt': intent.created_at.isoformat(),
                    'eraseBy': intent.erase_by.isoformat(),
                    'completedAt': None,
                    'confirmationExpiresAt': intent.confirmation_expires_at.isoformat(),
                    'retryable': intent.retryable,
                }
            },
            status=status.HTTP_201_CREATED,
        )


class DeletionView(SessionAuthMixin, APIView):
    """POST /api/mvp/account/deletion — confirm account deletion (anonymous)."""

    def post(self, request):
        receipt = request.data.get('receipt')
        confirmation = request.data.get('confirmation')
        if not receipt or confirmation != 'DELETE':
            return Response(
                {'error': 'receipt and confirmation: \"DELETE\" are required', 'code': 'INVALID_REQUEST'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        intent = AccountDeletionRequest.objects.filter(receipt=receipt).first()
        if intent is None:
            return Response(
                {'error': 'Deletion request not found', 'code': 'NOT_FOUND'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if intent.status != 'pending':
            if intent.status == 'completed':
                return Response(
                    {'accepted': True, 'deletion': {'receipt': intent.receipt, 'status': 'completed'}},
                    status=status.HTTP_200_OK,
                )
            return Response(
                {'error': 'This deletion request is no longer valid', 'code': 'INVALID_STATE'},
                status=status.HTTP_410_GONE,
            )

        if intent.confirmation_expires_at and intent.confirmation_expires_at <= timezone.now():
            intent.status = 'expired'
            intent.save(update_fields=['status'])
            return Response(
                {'error': 'Confirmation has expired', 'code': 'EXPIRED'},
                status=status.HTTP_410_GONE,
            )

        # Mark completed BEFORE deleting user, so the receipt survives
        intent.status = 'completed'
        intent.completed_at = timezone.now()
        intent.user = None  # survive cascade
        intent.save(update_fields=['status', 'completed_at', 'user'])

        # Now delete the user (cascade handles related rows)
        user = intent.user
        if user:
            user.delete()

        return Response(
            {'accepted': True, 'deletion': {'receipt': intent.receipt, 'status': 'completed'}},
            status=status.HTTP_200_OK,
        )


class DeletionStatusView(SessionAuthMixin, APIView):
    """GET /api/mvp/account/deletion/:receipt/ — status of a deletion request."""

    ALLOW_ANONYMOUS = True

    def get(self, request, receipt):
        intent = AccountDeletionRequest.objects.filter(receipt=receipt).first()
        if intent is None:
            return Response(
                {'error': 'Deletion request not found', 'code': 'NOT_FOUND'},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                'deletion': {
                    'receipt': intent.receipt,
                    'status': intent.status,
                    'requestedAt': intent.created_at.isoformat(),
                    'eraseBy': intent.erase_by.isoformat() if intent.erase_by else None,
                    'completedAt': intent.completed_at.isoformat() if intent.completed_at else None,
                    'confirmationExpiresAt': intent.confirmation_expires_at.isoformat() if intent.confirmation_expires_at else None,
                    'retryable': intent.retryable,
                }
            }
        )