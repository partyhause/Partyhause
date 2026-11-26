import uuid

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin

from .models import Notification


def _parse_ids(value):
    if not isinstance(value, list):
        return None
    parsed = []
    for item in value:
        try:
            parsed.append(uuid.UUID(str(item)))
        except (ValueError, TypeError, AttributeError):
            return None
    return parsed


def _actor(user):
    if user is None:
        return None
    profile = getattr(user, 'profile', None)
    username = (user.name or user.email.split('@')[0]).strip()
    return {
        'id': str(user.id),
        'username': username,
        'display_name': user.name or user.email,
        'avatar_url': profile.avatar_url if profile else None,
    }


def _serialize(notification):
    action_data = notification.action_data or notification.data or {}
    return {
        'id': str(notification.id),
        'user_id': str(notification.user_id),
        'type': notification.type,
        'title': notification.title,
        'body': notification.message,
        'read': notification.is_read,
        'actor': _actor(notification.actor),
        'event_id': str(notification.event_id) if notification.event_id else None,
        'post_id': notification.post_id,
        'action_data': action_data if action_data else None,
        'expires_at': (
            notification.expires_at.isoformat() if notification.expires_at else None
        ),
        'created_at': notification.created_at.isoformat(),
    }


def models_q_expires():
    from django.db.models import Q

    return Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now())


class NotificationListView(SessionAuthMixin, APIView):
    """GET /api/notifications/ — the caller's notification centre."""

    def get(self, request):
        try:
            limit = int(request.query_params.get('limit') or 30)
        except (TypeError, ValueError):
            limit = 30
        limit = max(1, min(limit, 100))

        notifications = (
            Notification.objects.filter(user=request.user)
            .select_related('actor', 'actor__profile')
            .filter(models_q_expires())
            .order_by('-created_at')[:limit]
        )
        data = [_serialize(notification) for notification in notifications]
        return Response({'notifications': data, 'count': len(data)})


class UnreadCountView(SessionAuthMixin, APIView):
    """GET /api/notifications/unread-count/ — badge count."""

    def get(self, request):
        count = (
            Notification.objects.filter(user=request.user, is_read=False)
            .filter(models_q_expires())
            .count()
        )
        return Response({'count': count})


class MarkReadView(SessionAuthMixin, APIView):
    """POST /api/notifications/mark-read/ — exactly one of `{ids}` or `{all}`."""

    def post(self, request):
        has_ids = 'ids' in request.data
        mark_all = request.data.get('all') is True

        if has_ids == mark_all:
            return Response(
                {
                    'error': 'Provide exactly one of ids or all:true',
                    'code': 'INVALID_REQUEST',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = Notification.objects.filter(user=request.user, is_read=False)
        if mark_all:
            updated = queryset.update(is_read=True)
            return Response({'success': True, 'updated': updated})

        ids = _parse_ids(request.data.get('ids'))
        if not ids or len(ids) > 50:
            return Response(
                {'error': 'ids must contain 1 to 50 valid ids', 'code': 'INVALID_REQUEST'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        updated = queryset.filter(id__in=ids).update(is_read=True)
        return Response({'success': True, 'updated': updated})
