from django.db import models
from django.conf import settings

from partyhause.model_utils import uuid_str

class OnboardingResponse(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='onboarding_response',
        db_column='user_id',
    )
    responses = models.JSONField(default=dict)
    completed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'onboarding_responses'


class AgenticConsent(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='agentic_consent',
        db_column='user_id',
    )
    enabled = models.BooleanField(default=False)
    consent_given_at = models.DateTimeField(blank=True, null=True)
    llm_provider = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'agentic_consent'
