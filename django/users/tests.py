import jwt
from datetime import datetime, timedelta
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status

from users.models import UserProfile
from accounts.authentication import SECRET, ALGORITHM

User = get_user_model()


def make_token(user):
    payload = {
        'sub': str(user.id),
        'email': user.email,
        'email_verified': user.email_verified,
        'account_role': user.account_role,
        'token_version': user.token_version,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(days=1),
    }
    return jwt.encode(payload, SECRET, algorithm=ALGORITHM)


class AuthenticatedClient(APIClient):
    def __init__(self, user, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.credentials(HTTP_AUTHORIZATION=f'Bearer {make_token(user)}')


class ProfileEndpointTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='alice@example.com', password='StrongPass123', name='Alice'
        )
        self.user.email_verified = True
        self.user.save(update_fields=['email_verified'])
        self.profile = UserProfile.objects.get(user=self.user)
        self.client = AuthenticatedClient(self.user)

    def test_me_returns_profile_fields(self):
        response = self.client.get(reverse('users:me'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data['id'], str(self.user.id))
        self.assertEqual(data['email'], 'alice@example.com')
        self.assertEqual(data['name'], 'Alice')
        self.assertTrue(data['email_verified'])
        self.assertIn('profile', data)
        self.assertEqual(data['profile']['is_private'], False)

    def test_put_profile_updates_writable_fields(self):
        response = self.client.put(reverse('users:me'), {
            'name': 'Alice Updated',
            'bio': 'Party planner',
            'location': 'Portland',
            'is_private': True,
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data['name'], 'Alice Updated')
        self.assertEqual(data['bio'], 'Party planner')
        self.assertEqual(data['location'], 'Portland')
        self.assertTrue(data['is_private'])

        self.user.refresh_from_db()
        self.assertEqual(self.user.name, 'Alice Updated')
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.bio, 'Party planner')
        self.assertEqual(self.profile.location, 'Portland')
        self.assertTrue(self.profile.is_private)

    def test_profile_is_private_defaults_false(self):
        self.assertFalse(self.profile.is_private)

    def test_unauthenticated_cannot_access_profile(self):
        unauth = APIClient()
        response = unauth.get(reverse('users:me'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class UserProfileAutoCreationTests(TestCase):
    def test_signup_creates_user_profile(self):
        user = User.objects.create_user(
            email='bob@example.com', password='StrongPass123', name='Bob'
        )
        self.assertTrue(UserProfile.objects.filter(user=user).exists())


class UserProfileViewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='carol@example.com', password='StrongPass123', name='Carol'
        )
        self.user.email_verified = True
        self.user.save(update_fields=['email_verified'])
        self.client = AuthenticatedClient(self.user)

    def test_profile_view_returns_full_profile(self):
        response = self.client.get(reverse('users:profile'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data['email'], 'carol@example.com')
        self.assertIn('profile', data)
