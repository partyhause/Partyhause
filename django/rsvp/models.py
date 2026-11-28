from django.db import models
from django.conf import settings

from partyhause.model_utils import uuid_str

class GuestInvitation(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='guest_invitations',
        db_column='event_id',
    )
    guest = models.ForeignKey(
        'guests.Guest',
        on_delete=models.CASCADE,
        related_name='invitations',
        db_column='guest_id',
    )
    email = models.EmailField()
    requires_account = models.BooleanField(default=False)
    token = models.CharField(max_length=255, unique=True)
    expires_at = models.DateTimeField()
    revoked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'guest_invitations'
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['token']),
            models.Index(fields=['expires_at']),
        ]


class InvitationDelivery(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    invitation = models.ForeignKey(
        GuestInvitation,
        on_delete=models.CASCADE,
        related_name='deliveries',
        db_column='invitation_id',
    )
    email = models.EmailField()
    status = models.CharField(max_length=20, default='pending')
    provider_message_id = models.CharField(max_length=255, blank=True, null=True)
    sent_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'invitation_deliveries'
        indexes = [
            models.Index(fields=['invitation']),
            models.Index(fields=['status']),
        ]


class AttendanceAudit(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='attendance_audits',
        db_column='actor_id',
    )
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='attendance_audits',
        db_column='event_id',
    )
    guest = models.ForeignKey(
        'guests.Guest',
        on_delete=models.CASCADE,
        related_name='attendance_audits',
        db_column='guest_id',
    )
    action = models.CharField(max_length=50)
    previous_status = models.CharField(max_length=20, blank=True, null=True)
    new_status = models.CharField(max_length=20, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'attendance_audits'
        indexes = [
            models.Index(fields=['actor']),
            models.Index(fields=['event']),
            models.Index(fields=['guest']),
            models.Index(fields=['created_at']),
        ]
