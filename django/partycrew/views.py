from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import get_user_model
from django.db.models import Q
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

from .models import Connection, ConnectionRequest


User = get_user_model()


def _user_summary(user):
    """Return a lightweight user dict for crew listings."""
    profile = getattr(user, 'profile', None)
    return {
        'id': str(user.id),
        'username': user.name or user.email.split('@')[0] if user.email else str(user.id),
        'display_name': user.name,
        'avatar_url': profile.avatar_url if profile else None,
        'bio': profile.bio if profile else None,
        'account_type': profile.account_type if profile else None,
        'events_hosted': profile.events_hosted if profile else 0,
        'is_verified': False,
        'is_private': profile.is_private if profile else False,
    }


class MembersView(SessionAuthMixin, APIView):
    """GET /api/partycrew/members?userId=<id> — users who follow the given user."""
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        target_id = request.query_params.get('userId') or str(request.user.id)
        try:
            target = User.objects.get(id=target_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        connections = Connection.objects.filter(connected_user=target).select_related('user', 'user__profile')
        members = [_user_summary(c.user) for c in connections]
        return Response({'members': members, 'total': len(members)})


class CrewingWithView(SessionAuthMixin, APIView):
    """GET /api/partycrew/crewing-with?userId=<id> — users the given user follows."""
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        target_id = request.query_params.get('userId') or str(request.user.id)
        try:
            target = User.objects.get(id=target_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        connections = Connection.objects.filter(user=target).select_related('connected_user', 'connected_user__profile')
        creators = [_user_summary(c.connected_user) for c in connections]
        return Response({
            'creators': creators,
            'total': len(creators),
        })


class ToggleView(SessionAuthMixin, APIView):
    """GET /api/partycrew/toggle?creatorId=<id> — crew status.
    POST /api/partycrew/toggle — join/leave a creator's crew."""
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        creator_id = request.query_params.get('creatorId')
        if not creator_id:
            return Response({'error': 'creatorId required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            creator = User.objects.get(id=creator_id)
        except User.DoesNotExist:
            return Response({'error': 'Creator not found'}, status=status.HTTP_404_NOT_FOUND)

        connected = Connection.objects.filter(user=request.user, connected_user=creator, status='connected').exists()
        return Response({'connected': connected, 'creator_id': creator_id})

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        creator_id = request.data.get('creatorId')
        if not creator_id:
            return Response({'error': 'creatorId required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            creator = User.objects.get(id=creator_id)
        except User.DoesNotExist:
            return Response({'error': 'Creator not found'}, status=status.HTTP_404_NOT_FOUND)

        if str(creator.id) == str(request.user.id):
            return Response({'error': 'Cannot crew with yourself'}, status=status.HTTP_400_BAD_REQUEST)

        connected = Connection.objects.filter(user=request.user, connected_user=creator, status='connected').first()
        if connected:
            connected.delete()
            return Response({'connected': False})
        Connection.objects.create(user=request.user, connected_user=creator, status='connected')
        return Response({'connected': True})


class RequestsView(SessionAuthMixin, APIView):
    """GET /api/partycrew/requests?userId=<id> — pending connection requests.
    POST /api/partycrew/requests — send a connection request."""
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        target_id = request.query_params.get('userId') or str(request.user.id)
        try:
            target = User.objects.get(id=target_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        requests = ConnectionRequest.objects.filter(to_user=target, status='pending').select_related('from_user', 'from_user__profile')
        request_list = []
        for r in requests:
            profile = getattr(r.from_user, 'profile', None)
            request_list.append({
                'id': str(r.id),
                'from_user': {
                    'id': str(r.from_user.id),
                    'username': r.from_user.name or r.from_user.email.split('@')[0] if r.from_user.email else str(r.from_user.id),
                    'display_name': r.from_user.name,
                    'avatar_url': profile.avatar_url if profile else None,
                },
                'status': r.status,
                'created_at': r.created_at.isoformat(),
            })
        return Response({'requests': request_list, 'total': len(request_list)})

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        to_user_id = request.data.get('to_user_id') or request.data.get('creatorId')
        if not to_user_id:
            return Response({'error': 'to_user_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            to_user = User.objects.get(id=to_user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        if str(to_user.id) == str(request.user.id):
            return Response({'error': 'Cannot send request to yourself'}, status=status.HTTP_400_BAD_REQUEST)

        # Don't create duplicate requests
        existing = ConnectionRequest.objects.filter(
            from_user=request.user, to_user=to_user, status='pending'
        ).first()
        if existing:
            return Response({
                'error': 'Request already pending',
                'request_id': str(existing.id),
            }, status=status.HTTP_409_CONFLICT)

        # If already connected, no need to request
        if Connection.objects.filter(user=request.user, connected_user=to_user, status='connected').exists():
            return Response({
                'error': 'Already connected',
            }, status=status.HTTP_409_CONFLICT)

        req = ConnectionRequest.objects.create(
            from_user=request.user,
            to_user=to_user,
            status='pending',
        )
        return Response({
            'success': True,
            'request_id': str(req.id),
            'status': 'pending',
        }, status=status.HTTP_201_CREATED)

    def delete(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        request_id = request.query_params.get('request_id') or request.data.get('request_id')
        if not request_id:
            return Response({'error': 'request_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            req = ConnectionRequest.objects.get(id=request_id, from_user=request.user)
        except ConnectionRequest.DoesNotExist:
            return Response({'error': 'Request not found'}, status=status.HTTP_404_NOT_FOUND)

        req.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
