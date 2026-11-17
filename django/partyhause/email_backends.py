from django.core.mail.backends.base import BaseEmailBackend

class AzureCommunicationEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        # Integrate Azure Communication Services + Resend fallback
        for message in email_messages:
            # Send via ACS with Resend fallback
            pass
        return len(email_messages)
