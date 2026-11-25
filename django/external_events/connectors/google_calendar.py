"""Google Calendar API v3 connector.

Requires per-user OAuth credentials (access + refresh token) stored in
``ExternalProviderConfig.api_key_enc`` or passed via ``config``. Uses
google-api-python-client for discovery-based calls.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
import json

try:
    from googleapiclient.discovery import build  # type: ignore
    from google.oauth2.credentials import Credentials  # type: ignore
except Exception:  # package not installed in dev until requirements are added
    build = None  # type: ignore
    Credentials = None  # type: ignore

from .base import BaseConnector, ExternalEventError


class GoogleCalendarConnector(BaseConnector):
    source = 'google_calendar'
    name = 'Google Calendar'

    def __init__(self, user=None, config: dict | None = None, api_key: Optional[str] = None):
        super().__init__(user=user, config=config)
        self.calendar_id = (config or {}).get('calendar_id', 'primary')
        self.credentials = self._build_credentials(api_key or config)

    def _build_credentials(self, config: Any) -> Optional[Any]:
        if Credentials is None:
            return None
        # ``config`` may be a dict (inline config) or a JSON string
        # (decrypted from ``ExternalProviderConfig.api_key_encrypted``).
        if isinstance(config, str):
            try:
                config = json.loads(config)
            except (json.JSONDecodeError, ValueError):
                return None
        if not isinstance(config, dict):
            return None
        token = config.get('access_token') or ''
        refresh = config.get('refresh_token') or ''
        client_id = config.get('client_id') or ''
        client_secret = config.get('client_secret') or ''
        if not token:
            return None
        return Credentials(
            token=token,
            refresh_token=refresh or None,
            client_id=client_id or None,
            client_secret=client_secret or None,
            token_uri='https://oauth2.googleapis.com/token',
        )

    def fetch(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        if build is None:
            raise ExternalEventError('google-api-python-client not installed')
        if self.credentials is None:
            raise ExternalEventError('google_calendar credentials not configured')

        time_min = since or (datetime.now(timezone.utc) - timedelta(days=30))
        time_max = time_min + timedelta(days=365)

        all_items: List[Dict[str, Any]] = []
        page_token = None

        try:
            service = build('calendar', 'v3', credentials=self.credentials, cache_discovery=False)
            while True:
                events_result = (
                    service.events()
                    .list(
                        calendarId=self.calendar_id,
                        timeMin=time_min.isoformat(),
                        timeMax=time_max.isoformat(),
                        singleEvents=True,
                        orderBy='startTime',
                        maxResults=2500,
                        pageToken=page_token,
                    )
                    .execute()
                )
                all_items.extend(events_result.get('items', []) or [])
                page_token = events_result.get('nextPageToken')
                if not page_token:
                    break
        except Exception as exc:  # noqa: BLE001
            raise ExternalEventError(f'google calendar fetch failed: {exc}') from exc

        return all_items

    def normalize(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        start = raw.get('start', {})
        end = raw.get('end', {})
        start_dt = self._event_dt(start)
        end_dt = self._event_dt(end)

        return {
            'external_event_id': str(raw.get('id') or ''),
            'name': raw.get('summary') or 'Untitled Event',
            'title': raw.get('summary') or 'Untitled Event',
            'description': raw.get('description') or '',
            'start_date': start_dt,
            'end_date': end_dt,
            'location': raw.get('location') or '',
            'location_name': raw.get('location') or '',
            'privacy': 'public',
            'status': 'draft',
            'max_guests': 0,
            'is_public': True,
            'template_type': 'external',
            'external_metadata': {
                'source': 'google_calendar',
                'calendar_id': self.calendar_id,
                'html_link': raw.get('htmlLink'),
            },
        }

    @staticmethod
    def _event_dt(field: Dict[str, Any]) -> Optional[str]:
        if not field:
            return None
        # All-day events use 'date'; timed events use 'dateTime'.
        raw = field.get('dateTime') or field.get('date')
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            return None
        try:
            from django.utils import timezone as dj_timezone

            if dj_timezone.is_naive(dt):
                dt = dj_timezone.make_aware(dt, dj_timezone.utc)
        except Exception:
            pass
        return dt.isoformat()
