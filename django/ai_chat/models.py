
from django.db import models
from django.conf import settings

from partyhause.model_utils import uuid_str

class AiUsage(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
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