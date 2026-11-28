
from django.contrib.postgres.fields import ArrayField
from django.db import models

from partyhause.model_utils import uuid_str

class TimelineBlock(models.Model):
    """A row of the `timeline_blocks` table.

    This is the table `/api/timeline` reads and writes. The `Event` model also
    carries a `timeline_blocks` JSON column, but that column is not the store:
    a JSON blob cannot express `guest_visible` per block, which is why the
    client moved to this table. The column is retained for the event DTO and
    is not read by these views.
    """

    BLOCK_TYPES = [
        ('activity', 'Activity'),
        ('meal', 'Meal'),
        ('speech', 'Speech'),
        ('performance', 'Performance'),
        ('break', 'Break'),
        ('custom', 'Custom'),
    ]

    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='timeline_rows',
        db_column='event_id',
    )
    label = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    start_time = models.DateTimeField()
    duration = models.IntegerField(help_text='Duration in minutes')
    type = models.CharField(max_length=20, choices=BLOCK_TYPES, default='activity')
    host_notes = models.TextField(blank=True, null=True)
    guest_visible = models.BooleanField(default=True)
    notify_before = models.IntegerField(blank=True, null=True)
    location = models.CharField(max_length=255, blank=True, null=True)
    assigned_to = ArrayField(
        models.CharField(max_length=255), default=list, blank=True
    )
    order_index = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'timeline_blocks'
        ordering = ['order_index', 'start_time']
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['start_time']),
            models.Index(fields=['event', 'order_index']),
        ]

    def __str__(self):
        return f'{self.label} — {self.event.name}'
