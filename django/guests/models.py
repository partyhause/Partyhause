from django.db import models
from django.conf import settings

from partyhause.model_utils import uuid_str

class Guest(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='guests', db_column='event_id')
    name = models.CharField(max_length=255)
    email = models.EmailField()
    normalized_email = models.EmailField(blank=True, default='')
    revision = models.IntegerField(default=1)
    rsvp_responded_at = models.DateTimeField(blank=True, null=True)
    is_checked_in = models.BooleanField(default=False)
    email_status = models.CharField(max_length=20, default='not_sent', blank=True, null=True)
    last_email_sent_at = models.DateTimeField(blank=True, null=True)
    email_log_id = models.CharField(blank=True, null=True, max_length=64)
    phone = models.CharField(max_length=50, blank=True, null=True)
    rsvp_status = models.CharField(max_length=20, default='pending')
    ticket_type = models.CharField(max_length=100, blank=True, null=True)
    ticket_id = models.CharField(max_length=100, blank=True, null=True)
    qr_code = models.CharField(max_length=255, blank=True, null=True)
    plus_ones = models.IntegerField(default=0)
    dietary_restrictions = models.JSONField(default=list)
    custom_fields = models.JSONField(default=dict)
    checked_in = models.BooleanField(default=False)
    checked_in_at = models.DateTimeField(blank=True, null=True)
    role = models.CharField(max_length=20, default='guest')
    metadata = models.JSONField(default=dict)
    user_id = models.CharField(blank=True, null=True, max_length=64)
    cost_share_enabled = models.BooleanField(default=False)
    cost_share_amount = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    payment_status = models.CharField(max_length=20, default='unpaid')
    payment_intent_id = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'guests'
        unique_together = [['event', 'normalized_email'], ['event', 'user_id']]
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['rsvp_status']),
            models.Index(fields=['email']),
            models.Index(fields=['checked_in']),
            models.Index(fields=['user_id']),
        ]

    def save(self, *args, **kwargs):
        self.normalized_email = self.email.lower().strip() if self.email else ''
        super().save(*args, **kwargs)
