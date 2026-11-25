"""
Django email backend for PartyHause.

Azure Communication Services is the primary transport; Resend is an explicit
fallback so verification, password-reset, and invitation mail keeps being
delivered while the ACS custom domain (partyhause.uk) is pending DNS
verification or during an ACS outage.

Modelled on the Express transport in server/lib/email.ts: ACS is preferred,
Resend is the fallback, neither path swallows failures silently, and the
sender address is fixed by configuration (never caller-supplied).
"""

import logging
import os
import time

from django.core.mail.backends.base import BaseEmailBackend

logger = logging.getLogger(__name__)

ACS_POLL_TIMEOUT_MS = 8000
ACS_POLL_INTERVAL_MS = 500


def _acs_connection_string():
    return (os.environ.get('ACS_CONNECTION_STRING') or '').strip() or None


def _acs_sender_address():
    return (os.environ.get('ACS_SENDER_ADDRESS') or '').strip() or None


def _resend_api_key():
    raw = (
        os.environ.get('RESEND_API_KEY')
        or os.environ.get('VITE_RESEND_API_KEY')
        or ''
    ).strip()
    if not raw:
        return None
    if 'placeholder' in raw or 'your_resend' in raw:
        return None
    return raw


def _resend_from_email():
    return (os.environ.get('RESEND_FROM_EMAIL') or '').strip() or None


class AzureCommunicationEmailBackend(BaseEmailBackend):
    """
    Send Django EmailMessage instances via Azure Communication Services, with
    Resend as fallback.

    Never raises unless `fail_silently` is False and both providers fail for a
    message, matching Django's backend contract. Returns the number of
    messages successfully handed off to a provider.
    """

    def __init__(self, fail_silently=False, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self._acs_client = None
        self._resend_client = None

    def send_messages(self, email_messages):
        if not email_messages:
            return 0

        sent = 0
        for message in email_messages:
            try:
                self._send_message(message)
                sent += 1
            except Exception as exc:  # noqa: BLE001 — per-message isolation
                if self.fail_silently:
                    logger.warning(
                        '[email] failed to send to %s (silent): %s',
                        message.to, exc,
                    )
                else:
                    logger.error(
                        '[email] failed to send to %s: %s', message.to, exc
                    )
                    raise
        return sent

    # ------------------------------------------------------------------
    # per-message delivery
    # ------------------------------------------------------------------
    def _send_message(self, message):
        sender = self._resolve_sender(message)
        recipients = [r for r in (message.to or []) if r]
        if not recipients:
            return

        subject = message.subject or ''
        body = self._html_body(message)

        acs_ok = self._send_via_acs(sender, recipients, subject, body, message)
        if acs_ok:
            return

        resend_ok = self._send_via_resend(sender, recipients, subject, body, message)
        if resend_ok:
            return

        raise RuntimeError(
            'Both ACS and Resend failed to deliver email to %s' % (recipients,)
        )

    # ------------------------------------------------------------------
    # providers
    # ------------------------------------------------------------------
    def _send_via_acs(self, sender, recipients, subject, body, message):
        conn = _acs_connection_string()
        acs_sender = _acs_sender_address()
        if not conn or not acs_sender:
            return False

        try:
            from azure.core.polling import LROPoller
            from azure.communication.email import EmailClient
        except ImportError:
            logger.warning(
                '[email] azure-communication-email not installed; skipping ACS'
            )
            return False

        try:
            if self._acs_client is None:
                self._acs_client = EmailClient.from_connection_string(conn)

            # Retry the entire ACS operation on throttling (TooManyRequests)
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    poller: LROPoller = self._acs_client.begin_send({
                        'senderAddress': acs_sender,
                        'content': {'subject': subject, 'html': body},
                        'recipients': {'to': [{'address': r} for r in recipients]},
                    })

                    # Bounded poll: ACS accepts immediately and completes asynchronously.
                    deadline = time.time() + (ACS_POLL_TIMEOUT_MS / 1000.0)
                    while not poller.done() and time.time() < deadline:
                        time.sleep(ACS_POLL_INTERVAL_MS / 1000.0)

                    if not poller.done():
                        # Already accepted by ACS; report success rather than failing.
                        return True

                    result = poller.result()
                    if result is None:
                        # ACS accepted but returned no result object; treat as accepted.
                        return True
                    status = getattr(result, 'status', None)
                    if status in ('Succeeded', None):
                        return True
                    logger.warning(
                        '[email] ACS finished with status %s for %s',
                        status, recipients,
                    )
                    return False
                except Exception as exc:
                    if 'TooManyRequests' in str(exc) and attempt < max_retries - 1:
                        time.sleep(1 * (attempt + 1))
                        continue
                    raise

            return False
        except Exception as exc:
            logger.warning('[email] ACS send error: %s', exc)
            return False

    def _send_via_resend(self, sender, recipients, subject, body, message):
        key = _resend_api_key()
        if not key:
            return False

        try:
            import resend  # type: ignore
        except ImportError:  # pragma: no cover
            logger.warning('[email] resend package not installed; skipping fallback')
            return False

        try:
            if self._resend_client is None:
                self._resend_client = resend.Resend(key)

            params = {
                'from': sender or _resend_from_email() or 'PartyHause <noreply@partyhause.uk>',
                'to': recipients,
                'subject': subject,
                'html': body,
            }
            reply_to = getattr(message, 'reply_to', None)
            if reply_to:
                params['reply_to'] = reply_to

            self._resend_client.emails.send(params)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning('[email] Resend fallback error: %s', exc)
            return False

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _resolve_sender(self, message):
        """Resolve the sender address.

        The sender is fixed by configuration (ACS_SENDER_ADDRESS, then
        RESEND_FROM_EMAIL), never caller-supplied. ACS rejects unverified
        senders, and an arbitrary caller-supplied From is spoofing — mirroring
        the Express transport in server/lib/email.ts. The message's own
        from_email is intentionally ignored.
        """
        acs_sender = _acs_sender_address()
        if acs_sender:
            return acs_sender
        return _resend_from_email() or 'PartyHause <noreply@partyhause.uk>'

    def _html_body(self, message):
        """Return HTML body for the message. Django EmailMessage may carry the
        body as plain text with an html alternative, or as html already."""
        alternatives = getattr(message, 'alternatives', None) or []
        for content, mimetype in alternatives:
            if mimetype == 'text/html':
                return content
        # If content_subtype is html, the body itself is HTML.
        if getattr(message, 'content_subtype', 'plain') == 'html':
            return message.body or ''
        # Otherwise wrap plain text body as minimal HTML.
        body = message.body or ''
        return '<p>%s</p>' % body.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
