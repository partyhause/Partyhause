import uuid

import jwt
from datetime import datetime, timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

User = get_user_model()
SECRET = settings.SECRET_KEY
ALGORITHM = 'HS256'
# Match Express JWT_EXPIRES_IN default of 7d so sessions don't expire prematurely.
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


class JWTAuthentication(BaseAuthentication):
    """
    Verify a bearer JWT and bind it to the current database identity state.

    Session/state contract (matches Express server/middleware/auth.ts):
      - Missing/invalid/expired/revoked/inactive token -> raise AuthenticationFailed -> 401 (wipe session)
      - Valid token but email not verified             -> return user, set request._email_verified=False
                                                         -> view returns 403 EMAIL_NOT_VERIFIED (preserve session)
      - Valid token + verified email                   -> return user, set request._email_verified=True -> 200

    Missing/invalid tokens raise AuthenticationFailed so DRF returns 401
    (wipe session). Unverified email is NOT an authentication failure — the
    token is valid — so we return the user and let the view return 403
    (preserve session), exactly as Express does.
    """

    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            raise AuthenticationFailed('No authentication credentials')
        token = auth_header.split(' ', 1)[1]
        try:
            payload = jwt.decode(token, SECRET, algorithms=[ALGORITHM])
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed('Token expired')
        except jwt.InvalidTokenError:
            raise AuthenticationFailed('Invalid token')
        user_id = payload.get('sub')
        token_version = payload.get('token_version', 0)
        try:
            user_id = uuid.UUID(user_id)
        except (ValueError, AttributeError, TypeError):
            raise AuthenticationFailed('Invalid token')
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            raise AuthenticationFailed('User not found')
        # Revocation check: logout/password reset/deletion bump token_version
        if getattr(user, 'token_version', 0) != token_version:
            raise AuthenticationFailed('Token revoked')
        if not user.account_status == 'active':
            raise AuthenticationFailed('Account not active')
        # Valid token. Record verification state on the request; views check
        # request._email_verified to return 403 EMAIL_NOT_VERIFIED without
        # wiping the client session (Express returns 403, not 401, here).
        request._email_verified = user.email_verified and payload.get('email_verified') is True
        return (user, token)
