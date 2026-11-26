import uuid
from django.db import models
from django.conf import settings


class EmailLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='email_logs',
        db_column='event_id',
        null=True,
        blank=True,
    )
    guest = models.ForeignKey(
        'guests.Guest',
        on_delete=models.SET_NULL,
        related_name='email_logs',
        db_column='guest_id',
        null=True,
        blank=True,
    )
    recipient = models.EmailField()
    subject = models.CharField(max_length=255)
    email_type = models.CharField(max_length=50, default='invitation')
    status = models.CharField(max_length=20, default='pending')
    provider = models.CharField(max_length=50, default='acs')
    provider_message_id = models.CharField(max_length=255, blank=True, null=True)
    resend_email_id = models.CharField(max_length=255, blank=True, null=True)
    template_id = models.UUIDField(blank=True, null=True)
    template_body = models.TextField(blank=True, null=True)
    sent_at = models.DateTimeField(blank=True, null=True)
    delivered_at = models.DateTimeField(blank=True, null=True)
    opened_at = models.DateTimeField(blank=True, null=True)
    clicked_at = models.DateTimeField(blank=True, null=True)
    bounced_at = models.DateTimeField(blank=True, null=True)
    error_message = models.TextField(blank=True, null=True)
    webhook_data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'email_logs'
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['recipient']),
            models.Index(fields=['status']),
            models.Index(fields=['created_at']),
        ]


class EmailEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email_log = models.ForeignKey(
        EmailLog,
        on_delete=models.CASCADE,
        related_name='events',
        db_column='email_log_id',
    )
    event_type = models.CharField(max_length=50)
    timestamp = models.DateTimeField(auto_now_add=True)
    data = models.JSONField(default=dict)

    class Meta:
        db_table = 'email_events'
        indexes = [
            models.Index(fields=['email_log']),
            models.Index(fields=['event_type']),
            models.Index(fields=['timestamp']),
        ]
