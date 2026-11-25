"""Provider connector registry.

Maps provider slugs to connector classes. Register every provider here so
endpoints can list and instantiate them by slug.
"""

from __future__ import annotations

from typing import Dict, Type

from .connectors.base import BaseConnector
from .connectors.ics import ICSConnector
from .connectors.google_calendar import GoogleCalendarConnector

# slug -> connector class
PROVIDERS: Dict[str, Type[BaseConnector]] = {}


def register(cls: Type[BaseConnector]) -> Type[BaseConnector]:
    """Decorator / callable to register a connector class by its ``source``."""
    PROVIDERS[cls.source] = cls
    return cls


# Register built-in connectors
register(ICSConnector)
register(GoogleCalendarConnector)


def get_connector(slug: str, user=None, config: Dict | None = None, api_key: Optional[str] = None) -> BaseConnector:
    """Instantiate a registered connector by slug; raises KeyError if unknown."""
    if slug not in PROVIDERS:
        raise KeyError(f'Unknown provider: {slug}')
    cls = PROVIDERS[slug]
    return cls(user=user, config=config or {}, api_key=api_key)


def list_providers() -> list[dict]:
    """Return metadata for every registered provider."""
    return [
        {'slug': slug, 'name': getattr(cls, 'name', cls.__name__)}
        for slug, cls in PROVIDERS.items()
    ]
