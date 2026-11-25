import uuid
from django.db import models
from django.conf import settings


class AccountDeletionRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
