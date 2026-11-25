import logging

from django.core.mail import EmailMessage, get_connection
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

logger = logging.getLogger(__name__)


class SendEmailView(SessionAuthMixin, APIView):
    """POST /api/send-email — Send invitation / guest correspondence.

    Body: { to: string|string[], subject: string, html: string, event_id?: string }
    The sender is fixed by the configured email backend (ACS / Resend); callers
    cannot supply a From address.
    """
    REQUIRES_VERIFIED = True

    def post(self, request):
        to = request.data.get('to')
        subject = request.data.get('subject')
        html = request.data.get('html')

        if not subject or not html:
            return Response(
                {'error': 'subject and html are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        recipients = to if isinstance(to, list) else [to]
        recipients = [r for r in recipients if r]
        if not recipients:
            return Response(
                {'error': 'to (recipient) is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            msg = EmailMessage(
                subject=subject,
                body=html,
                from_email=None,  # backend resolves the verified sender
                to=recipients,
            )
            msg.content_subtype = 'html'
            sent = get_connection().send_messages([msg])
            if not sent:
                return Response(
                    {'error': 'email not accepted by any provider'},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            return Response({'sent': True}, status=status.HTTP_200_OK)
        except Exception as e:
            logger.error('send-email failed: %s', e)
            return Response(
                {'error': 'email delivery failed'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
