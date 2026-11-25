from django.db import models
from django.conf import settings
from django.utils import timezone
import uuid
from typing import Optional

from .encryption import decrypt_value, encrypt_value


class ExternalProviderConfig(models.Model):
    """Configuration for an external event provider (ICS, Google Calendar, Ticketmaster, …).

    Provider credentials are encrypted at rest using Fernet (key from
    ``EXTERNAL_EVENTS_ENCRYPTION_KEY``). Without the key, credentials fall back
    to plaintext for local development only.
    """

    slug = models.SlugField(max_length=50, unique=True)  # 'ics', 'google_calendar', 'ticketmaster', …
    name = models.CharField(max_length=100)
    enabled = models.BooleanField(default=False)
    # Encrypted provider credentials / OAuth tokens. Access via get_api_key() / set_api_key().
    api_key_encrypted = models.BinaryField(blank=True, null=True)
    # Provider-specific base URL / calendar id / etc. (non-secret).
    config_json = models.JSONField(default=dict, blank=True)
    rate_limit_per_hour = models.IntegerField(default=60)
    last_sync_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'external_provider_config'
        ordering = ['slug']

    def __str__(self):
        return f'{self.slug} ({self.name})'

    # ---- credential accessors ------------------------------------------------

    def get_api_key(self) -> Optional[str]:
        """Return the decrypted API key / OAuth token, or None."""
        return decrypt_value(self.api_key_encrypted)

    def set_api_key(self, value: Optional[str]) -> None:
        """Encrypt and store the API key / OAuth token."""
        self.api_key_encrypted = encrypt_value(value)

    def has_credentials(self) -> bool:
        return self.api_key_encrypted is not None


class ExternalSyncRun(models.Model):
    """One execution of a provider sync. Records status and outcome for polling."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.CharField(max_length=100, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='external_sync_runs',
        null=True,
        blank=True,
    )
    status = models.CharField(
        max_length=20,
        default='queued',  # queued | running | completed | failed
    )
    events_fetched = models.IntegerField(default=0)
    events_inserted = models.IntegerField(default=0)
    events_updated = models.IntegerField(default=0)
    error = models.TextField(blank=True, null=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = 'external_sync_run'
        ordering = ['-started_at']

    def __str__(self):
        return f'{self.provider} {self.status} @ {self.started_at}'
