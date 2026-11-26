import logging
import re
import uuid

import bleach
from django.core.exceptions import ValidationError
from django.core.mail import EmailMessage, get_connection
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin, _SessionAuthStop
from events.models import Event, EventCoHost
from guests.models import Guest

logger = logging.getLogger(__name__)

MAX_RECIPIENTS = 100

# The tags an invitation email actually needs. Anything not listed is
# stripped rather than escaped, so a caller cannot smuggle a script through
# a body the host composed in a rich-text editor.
ALLOWED_TAGS = [
    'a', 'b', 'blockquote', 'br', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'hr',
    'i', 'img', 'li', 'ol', 'p', 'span', 'strong', 'table', 'tbody', 'td',
    'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]
ALLOWED_ATTRIBUTES = {
    'a': ['href', 'target', 'rel', 'style'],
    'img': ['src', 'alt', 'width', 'height', 'style'],
    '*': ['style', 'class'],
}
_CSS_DANGER = re.compile(r'(?:url|expression)\s*\([^)]*\)', re.IGNORECASE)
_SCRIPT_BLOCK = re.compile(r'<(script|style)\b[^>]*>.*?</\1>', re.IGNORECASE | re.DOTALL)
_STYLE_ATTR = re.compile(r'style="([^"]*)"', re.IGNORECASE)


def sanitize_email_html(raw_html: str) -> str:
    """Allowlist the tags an email needs and remove the two CSS vectors that
    survive tag filtering: url() and expression()."""
    without_scripts = _SCRIPT_BLOCK.sub('', raw_html)
    cleaned = bleach.clean(
        without_scripts,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=['http', 'https', 'mailto'],
        strip=True,
        strip_comments=True,
    )

    def _scrub_style(match):
        value = _CSS_DANGER.sub('', match.group(1))
        return f'style="{value}"'

    return _STYLE_ATTR.sub(_scrub_style, cleaned)


def can_invite(event, user) -> bool:
    if not event or not user or not user.is_authenticated:
        return False
    if event.host_id == user.id:
        return True
    co_host = EventCoHost.objects.filter(event=event, user=user).first()
    if co_host is None:
        return False
    if co_host.role in ('host', 'co-host', 'editor', 'organizer'):
        return True
    return bool((co_host.permissions or {}).get('can_invite'))


class SendEmailView(SessionAuthMixin, APIView):
    """POST /api/send-email — send correspondence to an event's own guests.

    A caller names an event, must hold invite permission on it, and may only
    address people already on that event's guest list. The endpoint is not a
    general mail relay: accepting an arbitrary recipient would let anyone send
    mail as the verified PartyHause domain.
    """

    REQUIRES_VERIFIED = True
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'email'

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as exc:
            return exc.args[0]

        event_id = request.data.get('event_id') or request.data.get('eventId')
        subject = request.data.get('subject')
        html = request.data.get('html')
        to = request.data.get('to')

        if not event_id:
            return Response(
                {'error': 'event_id is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not subject or not html:
            return Response(
                {'error': 'subject and html are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            event_uuid = uuid.UUID(str(event_id))
        except (ValueError, AttributeError, TypeError):
            return Response(
                {'error': 'event_id is not a valid identifier'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            event = Event.objects.filter(id=event_uuid).first()
        except ValidationError:
            event = None
        if event is None:
            return Response(
                {'error': 'Event not found'},
                status=status.HTTP_404_NOT_FOUND,
            )
        if not can_invite(event, request.user):
            return Response(
                {'error': 'You do not have permission to email this event'},
                status=status.HTTP_403_FORBIDDEN,
            )

        recipients = to if isinstance(to, list) else [to]
        recipients = [str(r).strip().lower() for r in recipients if r]
        if not recipients:
            return Response(
                {'error': 'to (recipient) is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(recipients) > MAX_RECIPIENTS:
            return Response(
                {
                    'error': f'At most {MAX_RECIPIENTS} recipients are allowed per request',
                    'code': 'TOO_MANY_RECIPIENTS',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        guest_emails = {
            (email or '').strip().lower()
            for email in Guest.objects.filter(event=event).values_list('email', flat=True)
        }
        strangers = [recipient for recipient in recipients if recipient not in guest_emails]
        if strangers:
            return Response(
                {
                    'error': 'Every recipient must already be a guest of this event',
                    'code': 'RECIPIENT_NOT_GUEST',
                    'recipients': strangers,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        safe_html = sanitize_email_html(html)
        try:
            message = EmailMessage(
                subject=subject,
                body=safe_html,
                from_email=None,  # the backend resolves the verified sender
                to=recipients,
            )
            message.content_subtype = 'html'
            sent = get_connection().send_messages([message])
            if not sent:
                return Response(
                    {'error': 'email not accepted by any provider'},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            return Response({'sent': True}, status=status.HTTP_200_OK)
        except Exception:
            logger.exception('send-email failed for event %s', event.id)
            return Response(
                {'error': 'email delivery failed'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
