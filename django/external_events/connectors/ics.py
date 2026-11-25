"""ICS / iCalendar feed connector.

Fetches a public .ics URL and normalizes each VEVENT into a Partyhause event.
No authentication required — suitable for public calendar feeds (holidays,
community calendars, public venue schedules, …).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

import requests
from icalendar import Calendar

from .base import BaseConnector, ExternalEventError


class ICSConnector(BaseConnector):
    source = 'ics'
    name = 'ICS / iCalendar feed'

    def __init__(self, user=None, config: dict | None = None):
        super().__init__(user=user, config=config)
        self.feed_url = (config or {}).get('feed_url', '')

    def fetch(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        if not self.feed_url:
            raise ExternalEventError('ics feed_url not configured')
        try:
            resp = requests.get(self.feed_url, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:  # noqa: BLE001
            raise ExternalEventError(f'failed to fetch ics feed: {exc}') from exc

        try:
            cal = Calendar.from_ical(resp.content)
        except Exception as exc:  # noqa: BLE001
            raise ExternalEventError(f'failed to parse ics feed: {exc}') from exc

        raw_events: List[Dict[str, Any]] = []
        for component in cal.walk():
            if component.name != 'VEVENT':
                continue
            raw_events.append(self._component_to_dict(component))

        # Incremental: skip events last-modified before `since`.
        if since is not None:
            filtered = []
            for ev in raw_events:
                last_mod = ev.get('last_modified')
                if last_mod is None:
                    # No last-modified info; keep to be safe.
                    filtered.append(ev)
                    continue
                try:
                    lm_dt = last_mod if isinstance(last_mod, datetime) else datetime.fromisoformat(str(last_mod))
                except (ValueError, AttributeError):
                    filtered.append(ev)
                    continue
                if lm_dt.tzinfo is None:
                    from django.utils import timezone as _tz
                    lm_dt = _tz.make_aware(lm_dt, _tz.utc)
                if lm_dt >= since:
                    filtered.append(ev)
            raw_events = filtered

        return raw_events

    def normalize(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        uid = str(raw.get('uid') or raw.get('id') or '')
        if not uid:
            uid = f"{raw.get('start','')}|{raw.get('summary','')}"

        start = self._to_iso(raw.get('start'))
        end = self._to_iso(raw.get('end')) or start

        return {
            'external_event_id': uid,
            'name': raw.get('summary') or 'Untitled Event',
            'title': raw.get('summary') or 'Untitled Event',
            'description': raw.get('description') or '',
            'start_date': start,
            'end_date': end,
            'location': raw.get('location') or '',
            'location_name': raw.get('location') or '',
            'privacy': 'public',
            'status': 'draft',
            'max_guests': 0,
            'is_public': True,
            'template_type': 'external',
            'external_metadata': {
                'source': 'ics',
            },
        }

    @staticmethod
    def _component_to_dict(component) -> Dict[str, Any]:
        def get(name):
            val = component.get(name)
            if val is None:
                return None
            if hasattr(val, 'dt'):
                return val.dt
            return str(val)

        return {
            'uid': get('UID'),
            'id': get('UID'),
            'summary': get('SUMMARY'),
            'description': get('DESCRIPTION'),
            'start': get('DTSTART'),
            'end': get('DTEND'),
            'last_modified': get('LAST-MODIFIED'),
            'location': get('LOCATION'),
        }

    @staticmethod
    def _to_iso(value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, datetime):
            dt = value
        else:
            try:
                dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                return None
        try:
            from django.utils import timezone as dj_timezone

            if dj_timezone.is_naive(dt):
                dt = dj_timezone.make_aware(dt, dj_timezone.utc)
        except Exception:
            pass
        return dt.isoformat()
