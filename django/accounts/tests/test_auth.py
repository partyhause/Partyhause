from django.test import TestCase
from django.contrib.auth import get_user_model
from django.urls import reverse

User = get_user_model()

class AuthTests(TestCase):
    def test_user_creation(self):
        user = User.objects.create_user(email='test@example.com', password='testpass123')
        self.assertEqual(user.email, 'test@example.com')
        self.assertTrue(user.check_password('testpass123'))
        self.assertFalse(user.email_verified)

    def test_signup_creates_unverified_user(self):
        response = self.client.post(reverse('accounts:signup'), {
            'email': 'new@example.com',
            'password': 'testpass123'
        })
        self.assertEqual(response.status_code, 302)
        user = User.objects.get(email='new@example.com')
        self.assertFalse(user.email_verified)
        self.assertIsNotNone(user.verification_token)

    def test_login_requires_verification(self):
        user = User.objects.create_user(email='login@example.com', password='testpass123')
        response = self.client.post(reverse('accounts:login'), {
            'email': 'login@example.com',
            'password': 'testpass123'
        })
        self.assertEqual(response.status_code, 200)  # stays on login page

    def test_email_verification(self):
        user = User.objects.create_user(email='verify@example.com', password='testpass123')
        user.verification_token = 'abc123'
        user.save()
        response = self.client.get(reverse('accounts:verify', kwargs={'token': 'abc123'}))
        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        self.assertEqual(user.verification_token, '')

    def test_password_reset_flow(self):
        user = User.objects.create_user(email='reset@example.com', password='oldpass')
        response = self.client.post(reverse('accounts:reset_request'), {'email': 'reset@example.com'})
        user.refresh_from_db()
        self.assertIsNotNone(user.reset_token)
