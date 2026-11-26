import uuid

from django.conf import settings
from django.db import models


class PartyBoardSticky(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='partyboard_stickies',
        db_column='event_id',
    )
    session_id = models.UUIDField(blank=True, null=True)
    type = models.CharField(max_length=20, default='note')
    position_x = models.IntegerField(default=0)
    position_y = models.IntegerField(default=0)
    width = models.IntegerField(default=200)
    height = models.IntegerField(default=200)
    rotation = models.IntegerField(blank=True, null=True)
    z_index = models.IntegerField(default=0)
    category = models.CharField(max_length=20, blank=True, null=True)
    data = models.JSONField(default=dict)
    creator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='partyboard_stickies_created',
        db_column='created_by',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'partyboard_stickies'
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['event', 'session_id']),
            models.Index(fields=['creator']),
        ]


class PartyBoardStickyVote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sticky = models.ForeignKey(
        PartyBoardSticky,
        on_delete=models.CASCADE,
        related_name='votes',
        db_column='sticky_id',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='partyboard_sticky_votes',
        db_column='user_id',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'partyboard_sticky_votes'
        unique_together = [['sticky', 'user']]
        indexes = [
            models.Index(fields=['sticky']),
            models.Index(fields=['user']),
        ]


class PartyBoardTask(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='partyboard_tasks',
    )
    sticky = models.OneToOneField(
        PartyBoardSticky,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='task',
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='partyboard_tasks',
    )
    completed = models.BooleanField(default=False)
    due_date = models.DateTimeField(blank=True, null=True)

    # The client contract exposes a status/priority/cost surface. These were
    # missing from the model, so the API could only return the four fields the
    # old Express implementation happened to read.
    status = models.CharField(max_length=20, default='open')
    priority = models.CharField(max_length=20, default='medium')
    estimated_cost = models.DecimalField(
        max_digits=12, decimal_places=2, blank=True, null=True
    )
    actual_cost = models.DecimalField(
        max_digits=12, decimal_places=2, blank=True, null=True
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='partyboard_tasks_created',
    )
    completed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'partyboard_tasks'
