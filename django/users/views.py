from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.contrib.auth import get_user_model
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

from users.serializers import ProfileSerializer

User = get_user_model()


class MeView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        serializer = ProfileSerializer(request.user)
        return Response(serializer.data)

    def put(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(ProfileSerializer(request.user).data)


class OnboardingView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        user = request.user
        profile = getattr(user, 'profile', None)
        return Response({
            'username': user.name or '',
            'display_name': user.name or '',
            'email_verified': user.email_verified,
            'account_role': user.account_role,
            'is_private': profile.is_private if profile else False,
        })


class OnboardingSkipView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({'skipped': True})


class ProfileView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        serializer = ProfileSerializer(request.user)
        return Response(serializer.data)

    def put(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(ProfileSerializer(request.user).data)


class UsernameView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def put(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        user = request.user
        username = request.data.get('username')
        if username:
            user.name = username
            user.save(update_fields=['name', 'updated_at'])
        return Response({
            'profile': { 'username': user.name },
            'unchanged': False,
        })


class UsernameAvailableView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        username = request.query_params.get('username', '')
        exists = User.objects.filter(name=username).exists()
        return Response({'available': not exists})


class SuggestedUsersView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        limit = int(request.query_params.get('limit', 20))
        users = User.objects.exclude(id=request.user.id)[:limit]
        return Response({
            'suggestions': [
                {
                    'id': str(u.id),
                    'username': u.name,
                    'display_name': u.name,
                    'is_verified': False,
                }
                for u in users
            ],
            'total': users.count(),
        })


class UserView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request, user_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            'id': str(user.id),
            'email': user.email,
            'name': user.name,
        })
