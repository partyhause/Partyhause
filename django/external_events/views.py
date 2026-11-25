"""Views for external event ingestion."""

from __future__ import annotations

import uuid
from typing import Optional

from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import NotFound

from accounts.session_auth import SessionAuthMixin, _SessionAuthStop
from events.models import Event
from .models import ExternalProviderConfig, ExternalSyncRun
from .registry import get_connector, list_providers, PROVIDERS
from .services import run_sync


class ProviderListView(SessionAuthMixin, APIView):
    """GET /api/external-events/sources/ — list configured providers."""

    REQUIRES_VERIFIED = False

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop:
            self.request.user = None

        enabled_slugs = set(
            ExternalProviderConfig.objects.filter(enabled=True).values_list(
                'slug', flat=True
            )
        )
        providers = []
        for p in list_providers():
            providers.append({**p, 'enabled': p['slug'] in enabled_slugs})
        return Response({'providers': providers})


class SyncCreateView(SessionAuthMixin, APIView):
    """POST /api/external-events/sync/ — start a sync run.

    Body: { "provider_slug": "ics" }
    """

    REQUIRES_VERIFIED = True

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]

        provider_slug = (request.data or {}).get('provider_slug')
        if not provider_slug:
            return Response(
                {'error': 'provider_slug is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if provider_slug not in PROVIDERS:
            return Response(
                {'error': f'Unknown provider: {provider_slug}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        run = run_sync(provider_slug, user=request.user)
        return Response(
            {
                'run_id': str(run.id),
                'provider': run.provider,
                'status': run.status,
                'events_fetched': run.events_fetched,
                'events_inserted': run.events_inserted,
                'events_updated': run.events_updated,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class SyncStatusView(SessionAuthMixin, APIView):
    """GET /api/external-events/sync/:run_id/ — poll sync status."""

    REQUIRES_VERIFIED = True

    def get(self, request, run_id):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]

        try:
            run = ExternalSyncRun.objects.get(id=run_id)
        except ExternalSyncRun.DoesNotExist:
            raise NotFound('Sync run not found')

        if run.user_id and request.user and str(run.user_id) != str(request.user.id):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Not your sync run')

        return Response(
            {
                'run_id': str(run.id),
                'provider': run.provider,
                'status': run.status,
                'events_fetched': run.events_fetched,
                'events_inserted': run.events_inserted,
                'events_updated': run.events_updated,
                'error': run.error,
                'started_at': run.started_at.isoformat() if run.started_at else None,
                'finished_at': run.finished_at.isoformat() if run.finished_at else None,
            }
        )


class ExternalEventListView(SessionAuthMixin, APIView):
    """GET /api/external-events/ — public discovery of externally sourced events.

    Returns events with external_source set. Supports ?source=<slug> filter.
    """

    REQUIRES_VERIFIED = False

    def get(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop:
            self.request.user = None

        source = request.query_params.get('source')
        user = self.request.user if getattr(self.request, 'user', None) and self.request.user.is_authenticated else None
        qs = Event.objects.exclude(external_source__isnull=True).exclude(
            external_source=''
        )
        # Privacy: only surface events this user imported (or all for unauthenticated
        # public discovery if desired; here we restrict to the caller's imports).
        if user:
            qs = qs.filter(imported_by=user)
        if source:
            qs = qs.filter(external_source=source)
        qs = qs.order_by('start_date')

        data = []
        for e in qs[:100]:
            from events.views import serialize_event, EventAccess

            data.append(serialize_event(e, EventAccess(e, user)))
        return Response({'events': data, 'count': len(data)})
