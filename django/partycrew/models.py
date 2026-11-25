import uuid
from django.db import models
from django.conf import settings


class Connection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='connections',
        db_column='user_id',
    )
    connected_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='connected_to',
        db_column='connected_user_id',
    )
    status = models.CharField(max_length=20, default='connected')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'connections'
        unique_together = [['user', 'connected_user']]
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['connected_user']),
        ]


class ConnectionRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    from_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='connection_requests_sent',
        db_column='from_user_id',
    )
    to_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='connection_requests_received',
        db_column='to_user_id',
    )
    status = models.CharField(max_length=20, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'connection_requests'
        unique_together = [['from_user', 'to_user']]


class UserBlock(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    blocker = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='blocking',
        db_column='blocker_id',
    )
    blocked = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='blocked_by',
        db_column='blocked_id',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'user_blocks'
        unique_together = [['blocker', 'blocked']]


class SavedEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='saved_events',
        db_column='user_id',
    )
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='saved_by',
        db_column='event_id',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'saved_events'
        unique_together = [['user', 'event']]
