from rest_framework.permissions import BasePermission
from rest_framework.exceptions import PermissionDenied


class IsVerified(BasePermission):
    """
    Session/state contract matching Express server/middleware/auth.ts:

    - authenticated + verified email   -> 200 (proceed)
    - authenticated + unverified email -> 403 EMAIL_NOT_VERIFIED
                                         (preserve the client session so the
                                          user can request a resend link)
    """

    message = 'Email address not confirmed'
    code = 'EMAIL_NOT_VERIFIED'

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False  # DRF -> 401 (missing/invalid token -> wipe session)
        if not getattr(request, '_email_verified', False):
            raise PermissionDenied(self.message, code=self.code)  # -> 403
        return True
