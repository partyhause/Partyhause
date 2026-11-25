from django.test import TestCase
from django.core.mail import send_mail
from partyhause.email_backends import AzureCommunicationEmailBackend

class EmailTests(TestCase):
    def test_azure_email_backend(self):
        backend = AzureCommunicationEmailBackend()
        messages = [
            type('msg', (), {'to': ['test@example.com'], 'subject': 'Test', 'body': 'Body'})()
        ]
        count = backend.send_messages(messages)
        self.assertEqual(count, 1)

    def test_send_mail_integration(self):
        send_mail(
            subject='Test',
            message='Body',
            from_email='noreply@partyhause.uk',
            recipient_list=['test@example.com'],
            fail_silently=True
        )
        # Should not raise
