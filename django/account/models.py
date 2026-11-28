from django.db import models
from django.conf import settings

from partyhause.model_utils import uuid_str

class AccountDeletionRequest(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='deletion_requests',
        db_column='user_id',
    )
    confirmation_word = models.CharField(max_length=50)
    confirmation_expires_at = models.DateTimeField()
    retryable = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'account_deletion_requests'
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['confirmation_expires_at']),
        ]
