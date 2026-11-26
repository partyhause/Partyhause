import jwt
from datetime import datetime, timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework.exceptions import APIException

User = get_user_model()
SECRET = settings.JWT_SECRET
ALGORITHM = 'HS256'
EXPIRY = timedelta(days=7)


class SessionAuthRequired(APIException):
    """Carry the 401/403 response produced by `_verify_token` through DRF.

    `initial()` cannot return a Response, so it raises this instead. DRF's
    exception handler renders `detail` at `status_code`, preserving the exact
    body the explicit call sites already returned.
    """

    def __init__(self, response):
        self.status_code = response.status_code
        self.detail = response.data
        super().__init__(self.detail)



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

    # A public read (system templates, a provider catalogue) opts out
    # explicitly. Every other view using this mixin is authenticated in
    # `initial()` even if its handler forgets to call `_verify_token`, which is
    # the failure mode that left /api/send-email and /api/partyplates open.
    ALLOW_ANONYMOUS = False

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        try:
            self._verify_token()
        except _SessionAuthStop as exc:
            if not self.ALLOW_ANONYMOUS:
                raise SessionAuthRequired(exc.args[0])
            request.user = AnonymousUser()
            request._email_verified = False

    def _verify_token(self):
        auth_header = self.request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            # Bearer only. The session-cookie fallback was removed because
            # /api/* is CSRF-exempt: accepting the cookie turned every endpoint
            # into a CSRF target. The web and mobile clients both send the
            # stored token in the Authorization header.
            self._unauthorized('Missing Authorization header')
        token = auth_header.split(' ', 1)[1]
        try:
            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
        except jwt.ExpiredSignatureError:
            self._unauthorized('Token expired')
        except jwt.InvalidTokenError:
            self._unauthorized('Invalid token')
        token_version = payload.get('token_version', 0)
        user_id = payload.get('sub')
        try:
            user = User.objects.get(id=user_id)
        except (User.DoesNotExist, ValueError, TypeError):
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
