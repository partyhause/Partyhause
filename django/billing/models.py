from django.db import models
from django.conf import settings

from partyhause.model_utils import uuid_str

class Subscription(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='subscription',
        db_column='user_id',
    )
    stripe_customer_id = models.CharField(max_length=255, blank=True, null=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True, null=True)
    plan = models.CharField(max_length=20, default='free')
    status = models.CharField(max_length=20, default='none')
    source = models.CharField(max_length=20, default='none')
    card_trial_started_at = models.DateTimeField(blank=True, null=True)
    trial_ends_at = models.DateTimeField(blank=True, null=True)
    first_paid_at = models.DateTimeField(blank=True, null=True)
    # current_period_start is deliberately absent: the column does not exist in the
    # table (Prisma's schema never created it) and the model declaring it made every
    # read of subscriptions raise "column ... does not exist". Nothing reads it.
    current_period_end = models.DateTimeField(blank=True, null=True)
    cancel_at_period_end = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'subscriptions'
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['status']),
        ]


class BillingEvent(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='billing_events',
        db_column='user_id',
    )
    # Columns as Prisma created them: provider_event_id, event_type,
    # payload_hash, provider, status, error, received_at, applied_at.
    # The model previously named several of these differently, which made
    # every billing_events read raise "column does not exist".
    provider_event_id = models.CharField(max_length=255, blank=True, null=True, unique=True)
    event_type = models.CharField(max_length=100)
    payload_hash = models.CharField(max_length=255, blank=True, null=True)
    provider = models.CharField(max_length=50, default='stripe')
    status = models.CharField(max_length=20, default='received')
    error = models.TextField(blank=True, null=True)
    received_at = models.DateTimeField(blank=True, null=True)
    applied_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = 'billing_events'
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['event_type']),
            models.Index(fields=['received_at']),
        ]
