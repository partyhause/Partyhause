import uuid

from django.db import models
from django.conf import settings


class AiUsage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='ai_usage',
        db_column='user_id',
    )
    source = models.CharField(max_length=20)  # 'llm' or 'heuristic'
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'ai_usage'
        indexes = [
            models.Index(fields=['user', 'source']),
            models.Index(fields=['user', 'created_at']),
        ]