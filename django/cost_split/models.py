import uuid
from django.db import models
from django.conf import settings


class CostSplitRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='cost_split_requests',
        db_column='event_id',
    )
    guest = models.ForeignKey(
        'guests.Guest',
        on_delete=models.SET_NULL,
        related_name='cost_split_requests',
        db_column='guest_id',
        null=True,
        blank=True,
    )
    creator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='cost_split_requests',
        db_column='creator_id',
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=10, default='USD')
    description = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=20, default='pending')
    payment_method = models.CharField(max_length=50, blank=True, null=True)
    payment_reference = models.CharField(max_length=255, blank=True, null=True)
    paid_at = models.DateTimeField(blank=True, null=True)
    reminder_sent_count = models.IntegerField(default=0)
    last_reminder_at = models.DateTimeField(blank=True, null=True)
    due_date = models.DateTimeField(blank=True, null=True)
    admin_notes = models.TextField(blank=True, null=True)
    guest_notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cost_split_requests'
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['creator']),
            models.Index(fields=['status']),
        ]


class EventCostSummary(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.OneToOneField(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='event_cost_summary',
        db_column='event_id',
    )
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_event_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_collected = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_pending = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_overdue = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    guests_with_splits = models.IntegerField(default=0)
    guests_paid = models.IntegerField(default=0)
    guests_pending = models.IntegerField(default=0)
    split_enabled = models.BooleanField(default=False)
    split_method = models.CharField(max_length=20, blank=True, null=True)
    currency = models.CharField(max_length=10, default='USD')
    breakdown = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'event_cost_summaries'
