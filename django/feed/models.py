from django.db import models
from django.conf import settings

from partyhause.model_utils import uuid_str

class PartycrewPost(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='partycrew_posts',
        db_column='event_id',
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='partycrew_posts',
        db_column='author_id',
    )
    content = models.TextField()
    media_url = models.URLField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'partycrew_posts'
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['author']),
            models.Index(fields=['created_at']),
        ]


class PostLike(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    post = models.ForeignKey(
        PartycrewPost,
        on_delete=models.CASCADE,
        related_name='likes',
        db_column='post_id',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='post_likes',
        db_column='user_id',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'post_likes'
        unique_together = [['post', 'user']]


class PostComment(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    post = models.ForeignKey(
        PartycrewPost,
        on_delete=models.CASCADE,
        related_name='comments',
        db_column='post_id',
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='post_comments',
        db_column='author_id',
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'post_comments'
        indexes = [
            models.Index(fields=['post']),
            models.Index(fields=['author']),
        ]


class PostShare(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    post = models.ForeignKey(
        PartycrewPost,
        on_delete=models.CASCADE,
        related_name='shares',
        db_column='post_id',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='post_shares',
        db_column='user_id',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'post_shares'
