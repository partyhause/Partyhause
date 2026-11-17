from django.utils.deprecation import MiddlewareMixin
from django.contrib.auth.models import AnonymousUser
from django.http import JsonResponse
import jwt
from django.conf import settings
from accounts.models import User


class JWTAuthenticationMiddleware(MiddlewareMixin):
    """
    Parse the HS256 JWT from the Authorization header and attach the user to
    the request, mirroring the Express auth middleware contract:

    - valid token                   -> request.user set, proceed
    - missing/invalid/expired token -> request.user stays AnonymousUser

    SessionAuthMixin (used by /api/auth/me/, RSVP, etc.) performs its own
    stricter verification (token_version, email_verified, account_status) and
    returns 401/403 as appropriate. This middleware only maps the bearer token
    to a Django user so DRF views and `request.user.is_authenticated` work.
    """

    def process_request(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            request.user = AnonymousUser()
            return None

        token = auth_header.split(' ', 1)[1]
        try:
            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=['HS256'],
            )
        except jwt.ExpiredSignatureError:
            request.user = AnonymousUser()
            return None
        except jwt.InvalidTokenError:
            request.user = AnonymousUser()
            return None

        user_id = payload.get('sub')
        if not user_id:
            request.user = AnonymousUser()
            return None

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            request.user = AnonymousUser()
            return None

        request.user = user
        return None


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
