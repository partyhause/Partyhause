from django.contrib.auth.models import AnonymousUser
import jwt
from django.conf import settings
from accounts.models import User
import logging
logger = logging.getLogger(__name__)


class CsrfExemptMiddleware:
    """
    Exempt /api/* from CSRF. This is a JWT-based API: the bearer token IS the
    credential, and session cookies are only a fallback transport. Requiring
    a CSRF cookie breaks stateless API clients and mobile.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/'):
            request._dont_enforce_csrf_checks = True
        return self.get_response(request)
from django.contrib.auth.models import AnonymousUser
import jwt
from django.conf import settings
from accounts.models import User
import logging
logger = logging.getLogger(__name__)


def _set_user_from_token(request):
    """Parse the HS256 JWT from the Authorization header and attach the user
    to the request, mirroring the Express auth middleware contract:

    - valid token                   -> request.user set, proceed
    - missing/invalid/expired token -> request.user stays AnonymousUser

    SessionAuthMixin (used by /api/auth/me/, RSVP, etc.) performs its own
    stricter verification (token_version, email_verified, account_status) and
    returns 401/403 as appropriate. This middleware only maps the bearer token
    to a Django user so DRF views and `request.user.is_authenticated` work.
    """
    auth_header = request.META.get('HTTP_AUTHORIZATION', '')
    logger.debug(f'JWT middleware: auth_header present={bool(auth_header)}')
    if not auth_header.startswith('Bearer '):
        # Fall back to token stored in Django session (set at login/signup)
        token = request.session.get('auth_token')
        if token:
            logger.debug('JWT middleware: no Bearer header, using session token')
            auth_header = f'Bearer {token}'
        else:
            request.user = AnonymousUser()
            logger.debug('JWT middleware: no Bearer header or session token, set AnonymousUser')
            return

    token = auth_header.split(' ', 1)[1]
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=['HS256'],
        )
    except jwt.ExpiredSignatureError as e:
        logger.debug(f'JWT middleware: expired token: {e}')
        request.user = AnonymousUser()
        return
    except jwt.InvalidTokenError as e:
        logger.debug(f'JWT middleware: invalid token: {e}')
        request.user = AnonymousUser()
        return

    user_id = payload.get('sub')
    if not user_id:
        request.user = AnonymousUser()
        logger.debug('JWT middleware: no sub in payload')
        return

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        request.user = AnonymousUser()
        logger.debug(f'JWT middleware: user {user_id} not found')
        return

    request.user = user
    logger.debug(f'JWT middleware: set user {user.id} ({user.email})')


class JWTAuthenticationMiddleware:
    """
    Uses __call__ style so it runs AFTER django's AuthenticationMiddleware
    (which is also __call__ style). This lets us override request.user with
    the JWT-decoded user rather than having AuthenticationMiddleware wipe us
    back to AnonymousUser.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _set_user_from_token(request)
        response = self.get_response(request)
        return response


class EventPermissionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)


class AuthBypassMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)


class SlashTolerantMiddleware:
    """
    Make Django API endpoints accept both /path and /path/
    Rewrite POST/PUT/PATCH/DELETE to the slash variant before URL resolution.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/') and not request.path.endswith('/') and request.path != '/':
            if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
                from django.urls import resolve
                from django.http import Http404
                try:
                    resolve(request.path + '/')
                    request.path_info = request.path + '/'
                    request.path = request.path + '/'
                except Http404:
                    pass
        return self.get_response(request)
