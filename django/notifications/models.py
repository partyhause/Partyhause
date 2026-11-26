import uuid
from django.db import models
from django.conf import settings


class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='notifications',
        db_column='event_id',
        null=True,
        blank=True,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
        db_column='user_id',
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='notifications_acted',
        db_column='actor_id',
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True, null=True)
    type = models.CharField(max_length=50, default='info')
    is_read = models.BooleanField(default=False)
    # The client contract calls this `action_data`; `data` is retained because
    # rows written before the rename still carry it.
    data = models.JSONField(default=dict)
    action_data = models.JSONField(default=dict)
    post_id = models.CharField(max_length=255, blank=True, null=True)
    expires_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'notifications'
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['is_read']),
            models.Index(fields=['created_at']),
        ]


class FeedReadStatus(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='feed_read_status',
        db_column='user_id',
    )
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='feed_read_status',
        db_column='event_id',
    )
    last_read_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'feed_read_status'
        unique_together = [['user', 'event']]


class ContentInteraction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='content_interactions',
        db_column='user_id',
    )
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='content_interactions',
        db_column='event_id',
        null=True,
        blank=True,
    )
    interaction_type = models.CharField(max_length=50)
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'content_interactions'
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['interaction_type']),
            models.Index(fields=['created_at']),
        ]
