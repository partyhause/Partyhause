"""Sync orchestration: run a provider sync and record a sync run.

Syncs execute in a background thread so the HTTP request returns immediately
with a ``run_id`` the client can poll via GET /api/external-events/sync/:run_id/.
"""

from __future__ import annotations

import threading
from typing import Optional

from django.utils import timezone

from .models import ExternalProviderConfig, ExternalSyncRun
from .registry import get_connector, PROVIDERS


def _run_sync_background(run_id: str, provider_slug: str, user_id: Optional[str]) -> None:
    """Background worker: execute connector sync and update the run record."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    run = ExternalSyncRun.objects.get(id=run_id)
    user = None
    if user_id:
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            user = None

    config = None
    api_key = None
    try:
        provider_cfg = ExternalProviderConfig.objects.get(slug=provider_slug)
        enabled = provider_cfg.enabled
        config = provider_cfg.config_json or {}
        api_key = provider_cfg.get_api_key()
    except ExternalProviderConfig.DoesNotExist:
        provider_cfg = None
        enabled = False

    if not enabled:
        run.status = 'failed'
        run.error = f'Provider {provider_slug} is not enabled'
        run.finished_at = timezone.now()
        run.save(update_fields=['status', 'error', 'finished_at'])
    connector = get_connector(provider_slug, user=user, config=config, api_key=api_key)

    try:
        result = connector.sync()
        run.events_fetched = result.get('fetched', 0)
        run.events_inserted = result.get('inserted', 0)
        run.events_updated = result.get('updated', 0)
        run.status = 'completed'
    except Exception as exc:  # noqa: BLE001 - record and mark failed
        run.status = 'failed'
        run.error = str(exc)
    finally:
        run.finished_at = timezone.now()
        run.save(
            update_fields=[
                'status',
                'events_fetched',
                'events_inserted',
                'events_updated',
                'error',
                'finished_at',
            ]
        )

    if provider_cfg is not None:
        provider_cfg.last_sync_at = run.finished_at
        provider_cfg.save(update_fields=['last_sync_at'])


def run_sync(provider_slug: str, user=None) -> ExternalSyncRun:
    """Queue a sync for ``provider_slug`` and return the run record immediately.

    The actual connector execution happens in a background thread; the caller
    should poll GET /api/external-events/sync/:run_id/ for completion.
    """
    run = ExternalSyncRun.objects.create(
        provider=provider_slug,
        user=user,
        status='queued',
    )

    user_id = str(user.id) if user else None

    thread = threading.Thread(
        target=_run_sync_background,
        args=(str(run.id), provider_slug, user_id),
        daemon=True,
    )
    thread.start()

    return run
