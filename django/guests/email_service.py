import secrets
from datetime import timedelta
from hashlib import sha256

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.html import strip_tags

from rsvp.models import GuestInvitation


class GuestInvitationService:
    def __init__(self, event):
        self.event = event

    def _mint_invitation(self, guest):
        """Create the row the RSVP page resolves, and return the raw token.

        The raw token goes in the URL and is never stored: `GuestInvitation`
        keeps its SHA-256 digest, so a database read cannot reconstruct a
        working link. Earlier versions generated a token, put it in the email,
        and wrote no row at all, which made every invitation link dead.
        """
        raw_token = secrets.token_urlsafe(32)
        digest = sha256(raw_token.encode()).hexdigest()
        ttl_days = int(getattr(settings, 'INVITATION_TTL_DAYS', 7))

        # One live link per guest. Re-sending an invitation must invalidate
        # the previous one rather than leaving two working credentials.
        GuestInvitation.objects.filter(
            event=self.event, guest=guest, revoked=False
        ).update(revoked=True)

        GuestInvitation.objects.create(
            event=self.event,
            guest=guest,
            email=guest.email,
            token=digest,
            expires_at=timezone.now() + timedelta(days=ttl_days),
            requires_account=False,
        )
        return raw_token

    def send_invitation(self, guest, custom_message=None):
        """Send an invitation email to a guest with a working RSVP link."""
        try:
            raw_token = self._mint_invitation(guest)
            base = settings.FRONTEND_URL.rstrip('/')
            join_url = f"{base}/join/{raw_token}"

            context = {
                'guest_name': guest.name,
                'event_name': self.event.name,
                'event_date': self.event.start_date.strftime('%B %d, %Y at %I:%M %p'),
                'event_location': self.event.location or '',
                'event_description': self.event.description or '',
                'join_url': join_url,
                'custom_message': custom_message,
                'host_name': (
                    self.event.host.name
                    if self.event.host and self.event.host.name
                    else (self.event.host.email if self.event.host else 'Your host')
                ),
            }

            html_message = render_to_string('emails/invitation.html', context)
            plain_message = strip_tags(html_message)

            send_mail(
                subject=f"You're invited to {self.event.name}",
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[guest.email],
                html_message=html_message,
                fail_silently=False,
            )

            guest.email_status = 'sent'
            guest.last_email_sent_at = timezone.now()
            guest.save(update_fields=['email_status', 'last_email_sent_at'])
            return True
        except Exception:
            guest.email_status = 'failed'
            guest.save(update_fields=['email_status'])
            raise

    def send_bulk_invitations(self, guests, custom_message=None):
        results = {'sent': 0, 'failed': 0, 'errors': []}
        for guest in guests:
            try:
                if self.send_invitation(guest, custom_message):
                    results['sent'] += 1
            except Exception as exc:
                results['failed'] += 1
                results['errors'].append(f"{guest.email}: {exc}")
        return results

    def send_reminder(self, guest):
        if guest.rsvp_status != 'pending':
            return False

        try:
            raw_token = self._mint_invitation(guest)
            base = settings.FRONTEND_URL.rstrip('/')
            join_url = f"{base}/join/{raw_token}"
            context = {
                'guest_name': guest.name,
                'event_name': self.event.name,
                'event_date': self.event.start_date.strftime('%B %d, %Y'),
                'rsvp_url': join_url,
            }
            html_message = render_to_string('emails/rsvp_reminder.html', context)
            plain_message = strip_tags(html_message)

            send_mail(
                subject=f"Reminder: RSVP for {self.event.name}",
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[guest.email],
                html_message=html_message,
                fail_silently=False,
            )
            guest.email_status = 'sent'
            guest.last_email_sent_at = timezone.now()
            guest.save(update_fields=['email_status', 'last_email_sent_at'])
            return True
        except Exception:
            return False
