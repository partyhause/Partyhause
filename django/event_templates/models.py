import uuid
from django.db import models
from django.conf import settings


class EventTemplate(models.Model):
    """Mirrors Prisma `templates` table — managed=False, Prisma is source of truth."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
        managed = False
        indexes = [
            models.Index(fields=['category']),
            models.Index(fields=['price_tier']),
            models.Index(fields=['slug']),
        ]


class TemplateUsage(models.Model):
    """Mirrors Prisma `template_usage` table — managed=False."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(
        EventTemplate,
        on_delete=models.CASCADE,
        db_column='template_id',
        related_name='template_usage',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        db_column='user_id',
        related_name='template_usage_records',
    )
    event_id = models.UUIDField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'template_usage'
        managed = False
        indexes = [
            models.Index(fields=['template_id']),
            models.Index(fields=['user_id']),
            models.Index(fields=['event_id']),
            models.Index(fields=['created_at']),
        ]
