from django.contrib.auth import authenticate
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.contrib.auth import get_user_model
from django.core.signing import TimestampSigner, BadSignature, SignatureExpired
from django.db import transaction
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth.hashers import check_password, make_password
from django.conf import settings
from django.core.mail import send_mail, EmailMessage
from django.template.loader import render_to_string
import secrets
from django.utils import timezone
from .serializers import (
    SignupSerializer,
    LoginSerializer,
    VerifyEmailSerializer,
    ResendVerificationSerializer,
    ForgotPasswordSerializer,
    ResetPasswordSerializer,
    MeSerializer,
    RoleUpdateSerializer,
)
from .authentication import sign_token
from .session_auth import SessionAuthMixin, _SessionAuthStop
signer = TimestampSigner()
User = get_user_model()


def _token_response(user, request=None):
    """Return a JWT token response matching the frontend's expectations."""
    token = sign_token(user)
    if request is not None:
        # Store JWT in Django session so authenticated requests can be
        # recognised even when the client sends no Authorization header.
        request.session['auth_token'] = token
        request.session['auth_user_id'] = str(user.id)
        request.session.save()
    return Response({
        'token': token,
        'user': {
            'id': str(user.id),
            'email': user.email,
            'name': user.name,
            'email_verified': user.email_verified,
            'account_role': user.account_role,
        },
    }, status=status.HTTP_200_OK)


class SignupView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = SignupSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                user = serializer.save()
                invite_token = request.data.get('invite_token') or ''
                if invite_token and user.email_verified:
                    # Invited signup: auto-verified, no verification email needed
                    return _token_response(user, request)
                # Non-invited sign-up: require verification
                new_token = secrets.token_urlsafe(32)
                user.verification_token = new_token
                user.verification_token_expires = timezone.now() + timezone.timedelta(hours=24)
                user.save(update_fields=['verification_token', 'verification_token_expires', 'updated_at'])
                try:
                    html_message = render_to_string(
                        'emails/verification_email.html',
                        {
                            'user': user,
                            'token': new_token,
                            'email': user.email,
                            'protocol': 'http',
                            'domain': 'localhost:5173',
                        },
                    )
                    msg = EmailMessage(
                        'Verify your PartyHause email',
                        html_message,
                        settings.DEFAULT_FROM_EMAIL,
                        [user.email],
                    )
                    msg.content_subtype = 'html'
                    msg.send(fail_silently=False)
                except Exception as e:
                    print(f'SIGNUP EMAIL ERROR: {e}')
                # Do not issue a session token for unverified sign-ups
                return Response({'user': {'id': str(user.id), 'email': user.email, 'name': user.name, 'email_verified': user.email_verified}, 'message': 'Check your email for a verification link.'}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            token = serializer.validated_data['token']
            user = User.objects.filter(verification_token=token).first()
            if not user:
                return Response({"error": "Invalid verification link"}, status=status.HTTP_400_BAD_REQUEST)
            expires = user.verification_token_expires
            if timezone.is_naive(expires):
                expires = timezone.make_aware(expires)
            if expires < timezone.now():
                return Response({"error": "Invalid verification link"}, status=status.HTTP_400_BAD_REQUEST)
            user.email_verified = True
            user.verification_token = None
            user.verification_token_expires = None
            user.save(update_fields=['email_verified', 'verification_token', 'verification_token_expires', 'updated_at'])
            # Store JWT in Django session so the session cookie authenticates
            # the browser on redirect to /auth. Do NOT return the token in the
            # body — the user signs in normally (no token handed to the user).
            request.session['auth_token'] = sign_token(user)
            request.session['auth_user_id'] = str(user.id)
            request.session.save()
            return Response({
                'success': True,
                'message': 'Email verified successfully. Please sign in.',
                'redirect': '/auth',
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ResendVerificationView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            email = serializer.validated_data['email']
            user = User.objects.filter(email=email).first()
            if not user:
                return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
            if user.email_verified:
                return Response({"message": "Already verified"}, status=status.HTTP_200_OK)
            new_token = secrets.token_urlsafe(32)
            user.verification_token = new_token
            user.verification_token_expires = timezone.now() + timezone.timedelta(hours=24)
            user.save(update_fields=['verification_token', 'verification_token_expires', 'updated_at'])
            try:
                    html_message = render_to_string(
                        'emails/verification_email.html',
                        {
                            'user': user,
                            'token': new_token,
                            'email': email,
                            'protocol': 'http',
                            'domain': 'localhost:5173',
                        },
                    )
                    msg = EmailMessage(
                        'Verify your PartyHause email',
                        html_message,
                        settings.DEFAULT_FROM_EMAIL,
                        [email],
                    )
                    msg.content_subtype = 'html'
                    msg.send(fail_silently=False)
            except Exception:
                pass
            return Response({"message": "Verification email resent"}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            email = serializer.validated_data['email']
            password = serializer.validated_data['password']
            try:
                user = authenticate(request, username=email, password=password)
            except TypeError:
                user = None
            if not user:
                return Response({"error": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)
            if not user.email_verified:
                return Response({"error": "Email not verified", "needs_email_verification": True}, status=status.HTTP_403_FORBIDDEN)
            return _token_response(user, request)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class MeView(SessionAuthMixin, APIView):
    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        serializer = MeSerializer(request.user)
        return Response(serializer.data)


class RoleUpdateView(SessionAuthMixin, APIView):
    def patch(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        serializer = RoleUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.update(request.user, serializer.validated_data)
        # Re-issue a token so the client picks up the new role immediately
        return _token_response(request.user, request)

class ForgotPasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            email = serializer.validated_data['email']
            user = User.objects.filter(email=email).first()
            if not user:
                # Respond uniformly whether or not the address is registered
                return Response({"message": "If an account exists, reset instructions will be sent."}, status=status.HTTP_200_OK)
            new_token = secrets.token_urlsafe(32)
            user.reset_token = new_token
            user.reset_token_expires = timezone.now() + timezone.timedelta(hours=24)
            user.save(update_fields=['reset_token', 'reset_token_expires', 'updated_at'])
            try:
                html_message = render_to_string(
                    'emails/password_reset_email.html',
                    {
                        'user': user,
                        'token': new_token,
                        'email': email,
                        'protocol': 'http',
                        'domain': 'localhost:5173',
                    },
                )
                msg = EmailMessage(
                    'Reset your PartyHause password',
                    html_message,
                    settings.DEFAULT_FROM_EMAIL,
                    [email],
                )
                msg.content_subtype = 'html'
                msg.send(fail_silently=False)
            except Exception:
                pass
            return Response({"message": "Password reset email sent"}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ResetPasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            email = serializer.validated_data['email']
            token = serializer.validated_data['token']
            password = serializer.validated_data['password']
            user = User.objects.filter(email=email, reset_token=token).first()
            if not user or user.reset_token_expires < timezone.now():
                return Response({"error": "Invalid or expired reset link"}, status=status.HTTP_400_BAD_REQUEST)
            user.set_password(password)
            user.reset_token = None
            user.reset_token_expires = None
            user.email_verified = True
            user.token_version += 1
            user.save(update_fields=['password', 'reset_token', 'reset_token_expires', 'email_verified', 'token_version', 'updated_at'])
            return Response({"message": "Password reset successfully. Sign in with your new password."}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if getattr(request, 'user', None) and request.user.is_authenticated:
            request.user.token_version += 1
            request.user.save(update_fields=['token_version', 'updated_at'])
        request.session.flush()
        return Response({"message": "Logged out"}, status=status.HTTP_200_OK)


class ResolveRSVPView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, invitation_token):
        from accounts.models import InvitationToken
        try:
            token = InvitationToken.objects.select_related('event', 'guest').get(token=invitation_token, revoked=False)
            if token.expires_at < timezone.now():
                return Response({"error": "Invitation link expired"}, status=status.HTTP_400_BAD_REQUEST)
            return Response({
                'event_id': str(token.event.id),
                'event_title': token.event.title,
                'invited_email': token.guest.email,
            }, status=status.HTTP_200_OK)
        except InvitationToken.DoesNotExist:
            return Response({"error": "Invalid invitation link"}, status=status.HTTP_400_BAD_REQUEST)


class SubmitRSVPView(APIView):
    permission_classes = [AllowAny]

    def put(self, request):
        data = request.data
        answer = data.get('answer')
        invitation_token = data.get('invitationToken')

        if not answer or not invitation_token:
            return Response({'error': 'answer and invitationToken required'}, status=status.HTTP_400_BAD_REQUEST)

        from guests.models import Guest as GuestModel
        guest = GuestModel.objects.select_related('event', 'user').filter(
            invitation_token=invitation_token
        ).first()

        if not guest:
            return Response({'error': 'Invalid invitation'}, status=status.HTTP_404_NOT_FOUND)

        if guest.user_id is not None:
            return Response({'error': 'Seat already claimed'}, status=status.HTTP_409_CONFLICT)

        if answer in ['yes', 'confirm']:
            event = guest.event
            if event.max_guests:
                accepted_count = GuestModel.objects.filter(
                    event=event, rsvp_status__in=['accepted', 'confirmed']
                ).count()
                if accepted_count >= event.max_guests:
                    return Response({'error': 'Event at capacity'}, status=status.HTTP_400_BAD_REQUEST)

            guest.rsvp_status = 'accepted'
            guest.save()

            auth_user = request.user if hasattr(request, 'user') and request.user.is_authenticated else None
            if auth_user and auth_user.email == guest.email:
                guest.user_id = auth_user.id
                guest.save()

            return Response({'status': 'accepted', 'seatBoundToAccount': auth_user is not None})

        elif answer == 'no':
            guest.rsvp_status = 'declined'
            guest.save()
            return Response({'status': 'declined'})

        else:
            guest.rsvp_status = 'pending'
            guest.save()
            return Response({'status': 'pending'})
