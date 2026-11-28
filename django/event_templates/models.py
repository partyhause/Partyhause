from django.db import models
from django.conf import settings

from partyhause.model_utils import uuid_str

class EventTemplate(models.Model):
    """Mirrors Prisma `templates` table — managed by Django migrations."""

    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='event_templates',
        db_column='author_id',
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=255)
    slug = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True, null=True)
    category = models.CharField(max_length=50, default='other')
    hero_image_url = models.URLField(blank=True, null=True)
    price_tier = models.CharField(max_length=20, default='free')
    default_payload = models.JSONField(default=dict)
    required_fields_schema = models.JSONField(blank=True, null=True)
    featured = models.BooleanField(default=False)
    published = models.BooleanField(default=True)
    usage_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'templates'
        managed = True
        indexes = [
            models.Index(fields=['category']),
            models.Index(fields=['price_tier']),
            models.Index(fields=['slug']),
        ]


class TemplateUsage(models.Model):
    """Mirrors Prisma `template_usage` table — managed by Django migrations."""

    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    template = models.ForeignKey(
        EventTemplate,
        on_delete=models.CASCADE,
        db_column='template_id',
        related_name='template_usage',
        null=True,
        blank=True,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        db_column='user_id',
        related_name='template_usage_records',
        null=True,
        blank=True,
    )
    event_id = models.CharField(blank=True, null=True, max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'template_usage'
        managed = True
        indexes = [
            models.Index(fields=['template_id']),
            models.Index(fields=['user_id']),
            models.Index(fields=['event_id']),
            models.Index(fields=['created_at']),
        ]
