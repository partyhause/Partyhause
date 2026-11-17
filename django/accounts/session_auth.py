import jwt
from datetime import datetime, timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.exceptions import AuthenticationFailed

User = get_user_model()
SECRET = settings.SECRET_KEY
ALGORITHM = 'HS256'
EXPIRY = timedelta(days=7)


def sign_token(user):
    payload = {
        'sub': str(user.id),
        'email': user.email,
        'email_verified': user.email_verified,
        'account_role': user.account_role,
        'token_version': getattr(user, 'token_version', 0),
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + EXPIRY,
    }
    return jwt.encode(payload, SECRET, algorithm=ALGORITHM)


class SessionAuthMixin:
    """
    Session/state contract matching Express server/middleware/auth.ts:

    - missing/invalid/expired/revoked/inactive token -> 401 SESSION_REVOKED (wipe session)
    - valid token but email not verified             -> 403 EMAIL_NOT_VERIFIED (preserve session)
    - valid token + verified email                   -> self.request.user set, proceed

    DRF's JWTAuthentication + permission classes conflate these into 403,
    which wrongly wipes the client session on unverified email. Express
    returns 401 only for genuinely invalid tokens and 403 for unverified
    email (session preserved so the user can resend a link). This mixin
    enforces that exact contract manually.
    """

    REQUIRES_VERIFIED = True

    def _verify_token(self):
        auth_header = self.request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            self._unauthorized('Missing Authorization header')
        token = auth_header.split(' ', 1)[1]
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        except jwt.ExpiredSignatureError:
            self._unauthorized('Token expired')
        except jwt.InvalidTokenError:
            self._unauthorized('Invalid token')
        user_id = payload.get('sub')
        token_version = payload.get('token_version', 0)
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            self._unauthorized('User not found')
        if getattr(user, 'token_version', 0) != token_version:
            self._unauthorized('Token revoked')
        if not user.account_status == 'active':
            self._unauthorized('Account not active')
        email_verified = user.email_verified and payload.get('email_verified') is True
        self.request.user = user
        self.request._email_verified = email_verified
        if self.REQUIRES_VERIFIED and not email_verified:
            self._forbidden()

    def _unauthorized(self, message):
        from rest_framework.response import Response
        from rest_framework import status
        self._session_response = Response(
            {'error': message, 'code': 'SESSION_REVOKED'},
            status=status.HTTP_401_UNAUTHORIZED,
        )
        raise _SessionAuthStop(self._session_response)

    def _forbidden(self):
        from rest_framework.response import Response
        from rest_framework import status
        self._session_response = Response(
            {
                'error': 'Email address not confirmed',
                'code': 'EMAIL_NOT_VERIFIED',
                'message': 'Confirm your email address to continue. Request a new link if it expired.',
            },
            status=status.HTTP_403_FORBIDDEN,
        )
        raise _SessionAuthStop(self._session_response)


class _SessionAuthStop(Exception):
    pass
