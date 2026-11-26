import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.core.mail import EmailMessage
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import sign_token
from .serializers import (
    ForgotPasswordSerializer,
    LoginSerializer,
    MeSerializer,
    ResendVerificationSerializer,
    ResetPasswordSerializer,
    RoleUpdateSerializer,
    SignupSerializer,
    VerifyEmailSerializer,
)
from .session_auth import SessionAuthMixin, _SessionAuthStop

logger = logging.getLogger(__name__)
User = get_user_model()


def _user_payload(user):
    return {
        'id': str(user.id),
        'email': user.email,
        'name': user.name,
        'email_verified': user.email_verified,
        'account_role': user.account_role,
    }


def _token_response(user):
    """Issue a bearer token. No session cookie is written: /api/* is
    CSRF-exempt and the clients store the token themselves."""
    return Response(
        {'token': sign_token(user), 'user': _user_payload(user)},
        status=status.HTTP_200_OK,
    )


def _frontend_parts():
    protocol, _, domain = (
        getattr(settings, 'FRONTEND_URL', 'http://localhost:5173').partition('://')
    )
    if not domain:
        protocol, domain = 'https', protocol
    return protocol, domain


def _send_html_email(subject, template_name, context, recipient):
    try:
        html_message = render_to_string(template_name, context)
        message = EmailMessage(
            subject,
            html_message,
            settings.DEFAULT_FROM_EMAIL,
            [recipient],
        )
        message.content_subtype = 'html'
        message.send(fail_silently=False)
        return True
    except Exception:
        # Delivery failure must not fail the request: the user can request
        # another link, and a 500 here would leak provider state.
        logger.exception('Email delivery failed for %s', recipient)
        return False


def _issue_verification(user):
    token = secrets.token_urlsafe(32)
    user.verification_token = token
    user.verification_token_expires = timezone.now() + timedelta(hours=24)
    user.save(
        update_fields=[
            'verification_token',
            'verification_token_expires',
            'updated_at',
        ]
    )
    protocol, domain = _frontend_parts()
    _send_html_email(
        'Verify your PartyHause email',
        'emails/verification_email.html',
        {
            'user': user,
            'token': token,
            'email': user.email,
            'protocol': protocol,
            'domain': domain,
        },
        user.email,
    )


class SignupView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        if email and User.objects.filter(email__iexact=email).exists():
            return Response(
                {
                    'error': 'An account with this email already exists',
                    'code': 'EMAIL_IN_USE',
                },
                status=status.HTTP_409_CONFLICT,
            )

        serializer = SignupSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                user = serializer.save()
                if user.email_verified:
                    # A valid invitation proves the address; the token was
                    # mailed to it. Sign in immediately, as the client expects.
                    return _token_response(user)
                _issue_verification(user)
        except Exception:
            logger.exception('Signup failed for %s', email)
            return Response(
                {'error': 'Could not create the account'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                'user': _user_payload(user),
                'message': 'Check your email for a verification link.',
            },
            status=status.HTTP_201_CREATED,
        )


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        token = serializer.validated_data['token']
        user = User.objects.filter(verification_token=token).first()
        if not user:
            return Response(
                {'error': 'Invalid verification link'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        expires = user.verification_token_expires
        if not expires or expires.replace(tzinfo=timezone.utc) < timezone.now():
            return Response(
                {'error': 'Invalid verification link'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user.email_verified = True
            user.verification_token = None
            user.verification_token_expires = None
            user.save(
                update_fields=[
                    'email_verified',
                    'verification_token',
                    'verification_token_expires',
                    'updated_at',
                ]
            )
        except Exception:
            logger.exception('Email verification failed for %s', user.id)
            return Response(
                {'error': 'Could not verify the address'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                'success': True,
                'message': 'Email verified successfully. Please sign in.',
                'redirect': '/auth',
            },
            status=status.HTTP_200_OK,
        )


class ResendVerificationView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data['email']
        user = User.objects.filter(email__iexact=email).first()
        if user and not user.email_verified:
            _issue_verification(user)

        # Identical answer whether or not the address exists, so this endpoint
        # cannot be used to enumerate accounts.
        return Response(
            {
                'success': True,
                'message': 'If an account exists and is unverified, a new link has been sent.',
            },
            status=status.HTTP_200_OK,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data['email']
        password = serializer.validated_data['password']
        try:
            user = authenticate(request, username=email, password=password)
        except TypeError:
            user = None

        if not user:
            return Response(
                {'error': 'Invalid credentials'},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if user.account_status != 'active':
            return Response(
                {'error': 'Account is not active', 'code': 'ACCOUNT_INACTIVE'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not user.email_verified:
            return Response(
                {
                    'error': 'Email not verified',
                    'code': 'EMAIL_NOT_VERIFIED',
                    'needs_email_verification': True,
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        return _token_response(user)


class MeView(SessionAuthMixin, APIView):
    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as exc:
            return exc.args[0]
        return Response(MeSerializer(request.user).data)


class RoleUpdateView(SessionAuthMixin, APIView):
    def patch(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as exc:
            return exc.args[0]
        serializer = RoleUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.update(request.user, serializer.validated_data)
        return _token_response(request.user)


class ForgotPasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data['email']
        user = User.objects.filter(email__iexact=email).first()
        if user:
            token = secrets.token_urlsafe(32)
            user.reset_token = token
            user.reset_token_expires = timezone.now() + timedelta(hours=24)
            user.save(
                update_fields=['reset_token', 'reset_token_expires', 'updated_at']
            )
            protocol, domain = _frontend_parts()
            _send_html_email(
                'Reset your PartyHause password',
                'emails/password_reset_email.html',
                {
                    'user': user,
                    'token': token,
                    'email': email,
                    'protocol': protocol,
                    'domain': domain,
                },
                email,
            )

        # Uniform response: do not reveal whether the address is registered.
        return Response(
            {
                'success': True,
                'message': 'If an account exists, reset instructions will be sent.',
            },
            status=status.HTTP_200_OK,
        )


class ResetPasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data['email']
        token = serializer.validated_data['token']
        password = serializer.validated_data['password']
        user = User.objects.filter(email__iexact=email, reset_token=token).first()
        if (
            not user
            or not user.reset_token_expires
            or user.reset_token_expires.replace(tzinfo=timezone.utc) < timezone.now()
        ):
            return Response(
                {'error': 'Invalid or expired reset link'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user.set_password(password)
            user.reset_token = None
            user.reset_token_expires = None
            user.email_verified = True
            # Invalidate every other session. The token returned below is
            # minted after the increment, so it carries the new epoch.
            user.token_version += 1
            user.save(
                update_fields=[
                    'password',
                    'reset_token',
                    'reset_token_expires',
                    'email_verified',
                    'token_version',
                    'updated_at',
                ]
            )
        except Exception:
            logger.exception('Password reset failed for %s', user.id)
            return Response(
                {'error': 'Could not reset the password'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # The web reset page writes both halves of the session from this
        # response (src/pages/ResetPasswordPage.tsx), so returning only a
        # message leaves the user signed out after a successful reset.
        return Response(
            {
                'success': True,
                'message': 'Password reset successfully.',
                'token': sign_token(user),
                'user': _user_payload(user),
            },
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if getattr(request, 'user', None) and request.user.is_authenticated:
            request.user.token_version += 1
            request.user.save(update_fields=['token_version', 'updated_at'])
        # The session backend is no longer an authentication path, but flush
        # it anyway so an older browser tab cannot keep a stale cookie.
        request.session.flush()
        return Response({'message': 'Logged out'}, status=status.HTTP_200_OK)
