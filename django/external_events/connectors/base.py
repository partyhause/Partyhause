"""Base connector for external event providers.

Subclasses implement ``fetch`` (raw provider events) and ``normalize`` (map to
Partyhause event fields). ``sync`` orchestrates fetch -> normalize -> bulk
upsert on ``(imported_by, external_source, external_event_id)`` so re-syncs
never duplicate rows.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.utils import timezone as dj_timezone
from django.contrib.auth import get_user_model
from django.core.cache import cache

from events.models import Event

User = get_user_model()

# Cache key prefix for rate-limit tracking per provider.
_RATELIMIT_CACHE_PREFIX = 'external_events:ratelimit:'


class ExternalEventError(Exception):
    """Raised when a provider connector fails."""


def _system_user() -> User:
    """Get or create a fixed system user that owns externally imported events.

    External events are read-only imports; a real user is required as
    ``host_id`` because Event.host is NOT NULL. This user is never used for
    login and its events are distinguished by ``imported_by`` + ``external_source``.
    """
    user, _created = User.objects.get_or_create(
        email='system@partyhause.local',
        defaults={
            'name': 'PartyHause System',
            'account_role': 'system',
            'is_active': False,
        },
    )
    return user


_SYSTEM_USER_ID: Optional[str] = None


def _get_system_user_id() -> str:
    """Cached system user id to avoid repeated DB hits."""
    global _SYSTEM_USER_ID
    if _SYSTEM_USER_ID is None:
        _SYSTEM_USER_ID = str(_system_user().id)
    return _SYSTEM_USER_ID


class BaseConnector(ABC):
    """Abstract provider connector.

    ``source`` is the value stored on ``Event.external_source`` (e.g. 'ics',
    'google_calendar', 'ticketmaster').
    """

    source: str = 'external'

    def __init__(self, user=None, config: Optional[Dict[str, Any]] = None):
        self.user = user
        self.config = config or {}

    @property
    @abstractmethod
    def source(self) -> str:
        """Provider slug stored on Event.external_source."""

    @abstractmethod
    def fetch(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Return raw provider events. Provider-specific paging/auth handled here."""

    @abstractmethod
    def normalize(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Map a raw provider event to Partyhause upsert fields.

        Returned dict may include any of:
          external_event_id, name, title, description, start_date, end_date,
          location, location_name, place_id, privacy, status, max_guests,
          is_public, external_metadata (dict), template_type
        """

    def _rate_limit_remaining(self) -> int:
        """Return remaining requests allowed this hour for this provider.

        Uses Django cache (Redis) keyed per provider. Not enforced here —
        callers should check before fetching. Returns -1 if cache unavailable.
        """
        try:
            key = f'{_RATELIMIT_CACHE_PREFIX}{self.source}'
            current = cache.get(key) or 0
            # rate_limit_per_hour comes from ExternalProviderConfig.config_json.
            limit = int((self.config or {}).get('rate_limit_per_hour', 60))
            remaining = max(0, limit - int(current))
            return remaining
        except Exception:
            return -1

    def _record_rate_limit_hit(self) -> None:
        """Increment the hourly request counter for this provider."""
        try:
            key = f'{_RATELIMIT_CACHE_PREFIX}{self.source}'
            cache.incr(key)
        except Exception:
            # Cache not configured; rate limiting is best-effort.
            pass

    def sync(self, since: Optional[datetime] = None) -> Dict[str, int]:
        """Fetch, normalize, and bulk upsert events for this provider.

        Returns ``{fetched, inserted, updated}`` counts.
        """
        raw_events = self.fetch(since=since) or []
        inserted = 0
        updated = 0

        # Rate-limit check: refuse to fetch if we've burned the hourly budget.
        remaining = self._rate_limit_remaining()
        if remaining == 0:
            return {'fetched': 0, 'inserted': 0, 'updated': 0}

        normalized: List[Dict[str, Any]] = []
        seen_ids: set = set()

        for raw in raw_events:
            try:
                fields = self.normalize(raw)
            except Exception:
                # Skip a single malformed event; continue the rest.
                continue

            external_event_id = fields.pop('external_event_id', None)
            external_metadata = fields.pop('external_metadata', {}) or {}

            if not external_event_id:
                continue

            # De-dupe within this batch by (source, external_event_id).
            batch_key = f'{self.source}:{external_event_id}'
            if batch_key in seen_ids:
                continue
            seen_ids.add(batch_key)

            # Strip internal leakage from metadata before persisting.
            safe_metadata = self._sanitize_metadata(external_metadata)

            defaults = {
                'host_id': _get_system_user_id(),
                'imported_by_id': self.user.id if self.user else None,
                'external_source': self.source,
                'external_metadata': safe_metadata,
                **fields,
            }
            normalized.append((external_event_id, defaults))

        if not normalized:
            self._record_rate_limit_hit()
            return {'fetched': len(raw_events), 'inserted': 0, 'updated': 0}

        with transaction.atomic():
            # Django 4.2-compatible bulk upsert: fetch existing keys, then
            # create new rows via create() (bulk_create strips auto_now_add)
            # and bulk_update changed ones.
            match_keys = [
                (defaults['imported_by_id'], self.source, eid)
                for eid, defaults in normalized
            ]
            existing_qs = Event.objects.filter(
                imported_by_id__in=[k[0] for k in match_keys if k[0]],
                external_source=self.source,
                external_event_id__in=[k[2] for k in match_keys],
            )
            existing_by_key = {
                (e.imported_by_id, e.external_source, e.external_event_id): e
                for e in existing_qs
            }

            to_update = []
            updatable_fields = [
                'name',
                'title',
                'description',
                'start_date',
                'end_date',
                'location',
                'location_name',
                'place_id',
                'privacy',
                'status',
                'max_guests',
                'is_public',
                'external_metadata',
                'template_type',
                'host_id',
                'imported_by_id',
                'updated_at',
            ]
            inserted = 0
            now = dj_timezone.now()

            for eid, defaults in normalized:
                key = (defaults['imported_by_id'], self.source, eid)
                existing = existing_by_key.get(key)
                if existing is None:
                    Event.objects.create(**{**defaults, 'external_event_id': eid})
                    inserted += 1
                else:
                    for field in updatable_fields:
                        setattr(existing, field, defaults.get(field, getattr(existing, field)))
                    existing.updated_at = now
                    to_update.append(existing)

            if to_update:
                Event.objects.bulk_update(to_update, updatable_fields)

        self._record_rate_limit_hit()
        return {'fetched': len(raw_events), 'inserted': inserted, 'updated': len(to_update)}
    @staticmethod
    def _sanitize_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Remove internal-only fields before persisting to external_metadata."""
        if not isinstance(metadata, dict):
            return {}
        safe = dict(metadata)
        safe.pop('feed_url', None)
        safe.pop('raw_uid', None)
        safe.pop('raw_id', None)
        return safe

    def _parse_datetime(self, value: Any) -> Optional[datetime]:
        """Best-effort parse of an ISO-8601 datetime; returns aware UTC or None."""
        if value is None or value == '':
            return None
        if isinstance(value, datetime):
            dt = value
        else:
            try:
                from datetime import datetime as _dt

                dt = _dt.fromisoformat(str(value).replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                return None
        if dj_timezone.is_naive(dt):
            dt = dj_timezone.make_aware(dt, dj_timezone.utc)
        return dt
