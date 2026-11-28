from django.db import models
from django.conf import settings

from partyhause.model_utils import uuid_str

class UserProfile(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='profile',
        db_column='user_id',
    )
    account_type = models.CharField(max_length=50, blank=True, null=True)
    bio = models.TextField(blank=True, null=True)
    avatar_url = models.URLField(blank=True, null=True)
    location = models.CharField(max_length=255, blank=True, null=True)
    website_url = models.URLField(blank=True, null=True)
    phone = models.CharField(max_length=50, blank=True, null=True)
    is_private = models.BooleanField(default=False)
    haus_score = models.IntegerField(default=0)
    partycrew_count = models.IntegerField(default=0)
    crewing_count = models.IntegerField(default=0)
    events_hosted = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'user_profiles'
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['account_type']),
        ]


class UsernameHistory(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='username_history',
        db_column='user_id',
    )
    username = models.CharField(max_length=150)
    is_generated = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'username_history'
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['username']),
        ]
