import uuid
from django.db import models
from django.conf import settings


class InviteTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='invite_templates',
        db_column='author_id',
    )
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=50, default='other')
    default_payload = models.JSONField(default=dict)
    usage_count = models.IntegerField(default=0)
    last_used_at = models.DateTimeField(blank=True, null=True)
    is_public = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'invite_templates'
        indexes = [
            models.Index(fields=['author']),
            models.Index(fields=['category']),
            models.Index(fields=['is_public']),
        ]
