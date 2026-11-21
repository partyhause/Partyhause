from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.contrib.auth import get_user_model
from django.db.models import Q
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

from .models import PartycrewPost, PostLike
from partycrew.models import Connection


User = get_user_model()


def _user_summary(user):
    """Return a lightweight user dict for feed posts."""
    profile = getattr(user, 'profile', None)
    return {
        'id': str(user.id),
        'username': user.name or user.email.split('@')[0] if user.email else str(user.id),
        'display_name': user.name,
        'avatar_url': profile.avatar_url if profile else None,
    }


class CrewFeedView(SessionAuthMixin, APIView):
    """GET /api/feed/crew — Personalized feed from users the caller follows."""
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        limit = int(request.query_params.get('limit', 20))
        content_type = request.query_params.get('content_type')

        # Get users the current user follows
        following = Connection.objects.filter(
            user=request.user, status='connected'
        ).values_list('connected_user', flat=True)

        # Build queryset: posts from followed users
        posts = PartycrewPost.objects.filter(author_id__in=following).select_related(
            'author', 'author__profile', 'event'
        )

        if content_type:
            posts = posts.filter(event__event_type=content_type)

        posts = posts.order_by('-created_at')[:limit]

        # Determine which posts the current user has liked
        liked_ids = set(
            PostLike.objects.filter(
                user=request.user,
                post__in=posts,
            ).values_list('post_id', flat=True)
        )

        feed_posts = []
        for post in posts:
            author = post.author
            profile = getattr(author, 'profile', None)
            feed_posts.append({
                'id': str(post.id),
                'author': _user_summary(author),
                'content': post.content,
                'created_at': post.created_at.isoformat() if post.created_at else None,
                'event_id': str(post.event_id) if post.event_id else None,
                'liked': str(post.id) in liked_ids,
            })

        return Response({'posts': feed_posts, 'total': len(feed_posts)})


class SeenView(SessionAuthMixin, APIView):
    """POST /api/feed/seen — Mark posts as seen."""
    REQUIRES_VERIFIED = True

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        post_ids = request.data.get('post_ids', [])
        if not post_ids:
            return Response({'error': 'post_ids required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            PostLike.objects.filter(
                user=request.user,
                post_id__in=post_ids,
            ).update(seen=True)
        except Exception:
            pass
        return Response({'marked': len(post_ids)})
