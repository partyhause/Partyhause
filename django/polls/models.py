
from django.conf import settings
from django.db import models

from partyhause.model_utils import uuid_str

class Poll(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='polls',
        db_column='event_id',
    )
    node_id = models.CharField(max_length=255, blank=True, null=True)
    creator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='polls_created',
        db_column='created_by',
        null=True,
    )
    question = models.CharField(max_length=500)
    poll_type = models.CharField(max_length=50, default='single-choice')
    ends_at = models.DateTimeField(blank=True, null=True)
    auto_close_on_consensus = models.BooleanField(default=False)
    consensus_threshold = models.IntegerField(default=70)
    status = models.CharField(max_length=20, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = 'polls'
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['creator']),
            models.Index(fields=['status']),
        ]


class PollOption(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    poll = models.ForeignKey(
        Poll, on_delete=models.CASCADE, related_name='options', db_column='poll_id'
    )
    text = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    class Meta:
        db_table = 'poll_options'
        indexes = [
            models.Index(fields=['poll']),
        ]


class PollVote(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    poll = models.ForeignKey(
        Poll, on_delete=models.CASCADE, related_name='votes', db_column='poll_id'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='poll_votes',
        db_column='user_id',
        null=True,
    )
    option = models.ForeignKey(
        PollOption, on_delete=models.CASCADE, related_name='votes', db_column='option_id'
    )
    rank = models.IntegerField(blank=True, null=True)
    voted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'poll_votes'
        # A multiple-choice or ranking poll stores one row per selected option,
        # so the uniqueness boundary is the (poll, user, option) triple. The
        # previous (poll, user) pair made a second selection an IntegrityError.
        unique_together = [['poll', 'user', 'option']]
        indexes = [
            models.Index(fields=['poll']),
            models.Index(fields=['user']),
        ]
