from django.contrib.auth.models import AnonymousUser
import jwt
from django.conf import settings
from accounts.models import User
import logging

logger = logging.getLogger(__name__)


class CsrfExemptMiddleware:
    """
    Exempt /api/* from CSRF.

    This is a bearer-token API: the Authorization header IS the credential,
    and it is not attached automatically by a browser. Session-cookie
    authentication was removed from the middleware and from SessionAuthMixin,
    so a cross-site request cannot ride an ambient cookie.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/'):
            request._dont_enforce_csrf_checks = True
        return self.get_response(request)


def _set_user_from_token(request):
    """Parse the HS256 JWT from the Authorization header and attach the user
    to the request.

    - valid, unrevoked, active token -> request.user set, proceed
    - missing/invalid/expired/revoked/inactive token -> AnonymousUser

    SessionAuthMixin performs the stricter contract (401 for an invalid token,
    403 for an unverified address) for views that need it. This middleware
    exists so `request.user.is_authenticated` is meaningful for the views that
    read it directly; it still enforces revocation and account status, because
    a token whose `token_version` is stale must not authenticate anything.
    """
    auth_header = request.META.get('HTTP_AUTHORIZATION', '')
    logger.debug('JWT middleware: auth_header present=%s', bool(auth_header))
    if not auth_header.startswith('Bearer '):
        request.user = AnonymousUser()
        return

    token = auth_header.split(' ', 1)[1]
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=['HS256'])
    except jwt.ExpiredSignatureError as exc:
        logger.debug('JWT middleware: expired token: %s', exc)
        request.user = AnonymousUser()
        return
    except jwt.InvalidTokenError as exc:
        logger.debug('JWT middleware: invalid token: %s', exc)
        request.user = AnonymousUser()
        return

    user_id = payload.get('sub')
    if not user_id:
        request.user = AnonymousUser()
        return

    try:
        user = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        request.user = AnonymousUser()
        return

    if getattr(user, 'token_version', 0) != payload.get('token_version', 0):
        logger.debug('JWT middleware: token revoked for user %s', user.id)
        request.user = AnonymousUser()
        return
    if user.account_status != 'active':
        logger.debug('JWT middleware: account not active for user %s', user.id)
        request.user = AnonymousUser()
        return

    request.user = user
    request._email_verified = user.email_verified and payload.get('email_verified') is True
    logger.debug('JWT middleware: set user %s (%s)', user.id, user.email)


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
        return self.get_response(request)


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
    Make Django API endpoints accept both /path and /path/.

    Rewrites the incoming path to whichever variant actually resolves, so a
    client and the URLconf cannot disagree about the trailing slash. Both
    directions are handled and every method is included: GET reads were the
    half that was missing, which is why every partycrew listing 404'd while
    the POST writes kept working.

    It runs before CommonMiddleware on purpose (see settings.py). APPEND_SLASH
    only redirects when the slash-less path fails to resolve, so it never
    redirects for us here; doing the rewrite in-process also avoids the 301
    that would turn a POST into a GET and drop its body.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/') and request.path != '/':
            candidate = _slash_variant_that_resolves(request.path)
            if candidate is not None:
                request.path = candidate
                request.path_info = candidate
        return self.get_response(request)


def _slash_variant_that_resolves(path):  # noqa: N802  (kept module-level so tests can call it directly)
    """
    Return the slash-ful or slash-less variant of `path` that resolves, or None.

    None means "leave the path alone": either it already resolves as-is, or
    neither variant exists and the real 404 is the correct answer. Importing
    resolve inside the call keeps module import free of a Django URLconf
    dependency, which matters for management commands that import this module
    before apps are ready.
    """
    from django.urls import resolve
    from django.http import Http404

    if not path.endswith('/'):
        try:
            resolve(path + '/')
            return path + '/'
        except Http404:
            return None
    else:
        try:
            resolve(path.rstrip('/'))
            return path.rstrip('/')
        except Http404:
            return None
