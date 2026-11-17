from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.conf import settings
from .models import Guest
from events.models import Event
import secrets
from datetime import timedelta
from django.utils import timezone

class GuestInvitationService:
    def __init__(self, event):
        self.event = event
    
    def send_invitation(self, guest, custom_message=None):
        """Send invitation email to guest with RSVP link"""
        try:
            # Generate invitation token
            token = secrets.token_urlsafe(32)
            
            # Build RSVP URLs
            rsvp_base = f"{settings.FRONTEND_URL}/rsvp/{self.event.id}"
            accept_url = f"{rsvp_base}?token={token}&status=accepted"
            decline_url = f"{rsvp_base}?token={token}&status=declined"
            maybe_url = f"{rsvp_base}?token={token}&status=maybe"
            
            context = {
                'guest_name': guest.name,
                'event_name': self.event.name,
                'event_date': self.event.start_date.strftime('%B %d, %Y at %I:%M %p'),
                'event_location': self.event.location,
                'event_description': self.event.description,
                'accept_url': accept_url,
                'decline_url': decline_url,
                'maybe_url': maybe_url,
                'custom_message': custom_message,
                'host_name': self.event.host.name if self.event.host.name else self.event.host.email
            }
            
            # Render email templates
            html_message = render_to_string('emails/invitation.html', context)
            plain_message = strip_tags(html_message)
            
            send_mail(
                subject=f"You're invited to {self.event.name}",
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[guest.email],
                html_message=html_message,
                fail_silently=False
            )
            
            # Update guest email status
            guest.email_status = 'sent'
            guest.last_email_sent_at = timezone.now()
            guest.save()
            
            return True
            
        except Exception as e:
            guest.email_status = 'failed'
            guest.save()
            raise e
    
    def send_bulk_invitations(self, guests, custom_message=None):
        """Send invitations to multiple guests"""
        results = {'sent': 0, 'failed': 0, 'errors': []}
        
        for guest in guests:
            try:
                if self.send_invitation(guest, custom_message):
                    results['sent'] += 1
            except Exception as e:
                results['failed'] += 1
                results['errors'].append(f"{guest.email}: {str(e)}")
        
        return results
    
    def send_reminder(self, guest):
        """Send RSVP reminder to guest who hasn't responded"""
        if guest.rsvp_status != 'pending':
            return False
        
        try:
            rsvp_base = f"{settings.FRONTEND_URL}/rsvp/{self.event.id}"
            rsvp_url = f"{rsvp_base}?guest_id={guest.id}"
            
            context = {
                'guest_name': guest.name,
                'event_name': self.event.name,
                'event_date': self.event.start_date.strftime('%B %d, %Y'),
                'rsvp_url': rsvp_url
            }
            
            html_message = render_to_string('emails/rsvp_reminder.html', context)
            plain_message = strip_tags(html_message)
            
            send_mail(
                subject=f"Reminder: RSVP for {self.event.name}",
                message=plain_message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[guest.email],
                html_message=html_message,
                fail_silently=False
            )
            
            guest.email_status = 'sent'
            guest.last_email_sent_at = timezone.now()
            guest.save()
            
            return True
            
        except Exception:
            return False
