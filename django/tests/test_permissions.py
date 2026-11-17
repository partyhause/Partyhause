from django.test import TestCase
from django.contrib.auth import get_user_model
from partyhause.permissions import IsEventHost, IsGuest

User = get_user_model()

class PermissionTests(TestCase):
    def setUp(self):
        self.host = User.objects.create_user(email='host@example.com', password='pass')
        self.guest = User.objects.create_user(email='guest@example.com', password='pass')

    def test_is_event_host(self):
        permission = IsEventHost()
        class MockObj:
            host_id = self.host.id
        req = type('req', (), {'user': self.host})()
        self.assertTrue(permission.has_object_permission(req, None, MockObj()))

    def test_is_not_event_host(self):
        permission = IsEventHost()
        class MockObj:
            host_id = self.guest.id
        req = type('req', (), {'user': self.host})()
        self.assertFalse(permission.has_object_permission(req, None, MockObj()))
