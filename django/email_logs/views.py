import uuid

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin
from events.models import Event
from events.views import EventAccess
from guests.models import Guest

from .models import EmailLog

DATETIME_FIELDS = {
    'sent_at': 'sent_at',
    'delivered_at': 'delivered_at',
    'opened_at': 'opened_at',
    'clicked_at': 'clicked_at',
    'bounced_at': 'bounced_at',
}


def _event(value):
    try:
        return Event.objects.filter(id=value).first()
    except (ValueError, TypeError):
        return None


def _log(value):
    try:
        return (
            EmailLog.objects.select_related('event', 'guest')
            .filter(id=value)
            .first()
        )
    except (ValueError, TypeError):
        return None


def _host(event, user):
    return EventAccess(event, user).is_host


def _serialize(log):
    return {
        'id': str(log.id),
        'event_id': str(log.event_id) if log.event_id else None,
        'guest_id': str(log.guest_id) if log.guest_id else None,
        'guest': (
            {'name': log.guest.name, 'email': log.guest.email} if log.guest else None
        ),
        'event': (
            {
                'name': log.event.name,
                'event_date': log.event.event_date.isoformat() if log.event.event_date else None,
                'location': log.event.location,
            }
            if log.event
            else None
        ),
        'email_type': log.email_type,
        'recipient_email': log.recipient,
        'recipient': log.recipient,
        'subject': log.subject,
        'status': log.status,
        'provider': log.provider,
        'resend_email_id': log.resend_email_id or log.provider_message_id,
        'template_id': str(log.template_id) if log.template_id else None,
        'template_body': log.template_body,
        'sent_at': log.sent_at.isoformat() if log.sent_at else None,
        'delivered_at': log.delivered_at.isoformat() if log.delivered_at else None,
        'opened_at': log.opened_at.isoformat() if log.opened_at else None,
        'clicked_at': log.clicked_at.isoformat() if log.clicked_at else None,
        'bounced_at': log.bounced_at.isoformat() if log.bounced_at else None,
        'error_message': log.error_message,
        'created_at': log.created_at.isoformat(),
        'updated_at': log.updated_at.isoformat(),
    }


def _parse_datetime(value):
    if value in (None, ''):
        return None
    parsed = parse_datetime(str(value))
    if parsed is not None and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


class EmailLogListView(SessionAuthMixin, APIView):
    """GET/POST /api/email-logs/."""

    def get(self, request):
        event_id = request.query_params.get('eventId') or request.query_params.get('event_id')
        guest_id = request.query_params.get('guestId') or request.query_params.get('guest_id')
        if not event_id and not guest_id:
            return Response(
                {'error': 'eventId or guestId query parameter required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        event = None
        if event_id:
            event = _event(event_id)
            if event is None:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
            if not _host(event, request.user):
                return Response(
                    {'error': 'Only the event host can view email logs for this event'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        guest = None
        if guest_id:
            try:
                guest = Guest.objects.select_related('event').filter(id=guest_id).first()
            except (ValueError, TypeError):
                guest = None
            if guest is None:
                return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)
            if not _host(guest.event, request.user):
                return Response(
                    {'error': 'Only the event host can view email logs for this guest'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if event is not None and str(guest.event_id) != str(event.id):
                return Response(
                    {'error': 'Guest does not belong to this event'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            limit = int(request.query_params.get('limit') or 100)
        except (TypeError, ValueError):
            limit = 100
        limit = max(1, min(limit, 500))

        logs = EmailLog.objects.select_related('event', 'guest')
        if event_id:
            logs = logs.filter(event_id=event_id)
        if guest_id:
            logs = logs.filter(guest_id=guest_id)
        logs = logs.order_by('-created_at')[:limit]

        return Response({'email_logs': [_serialize(log) for log in logs]})

    def post(self, request):
        data = request.data
        recipient = data.get('recipient_email') or data.get('recipient')
        subject = data.get('subject')
        email_type = data.get('email_type') or data.get('emailType')
        if not recipient or not subject or not email_type:
            return Response(
                {
                    'error': 'Missing required fields: recipient_email, subject, email_type'
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        event_id = data.get('event_id') or data.get('eventId')
        event = None
        if event_id:
            event = _event(event_id)
            if event is None:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
            if not _host(event, request.user):
                return Response(
                    {'error': 'Only the event host can log emails for this event'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        guest = None
        guest_id = data.get('guest_id') or data.get('guestId')
        if guest_id:
            try:
                guest = Guest.objects.filter(id=guest_id).first()
            except (ValueError, TypeError):
                guest = None
            if guest is None:
                return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)
            if event is not None and str(guest.event_id) != str(event.id):
                return Response(
                    {'error': 'Guest does not belong to this event'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not _host(guest.event, request.user):
                return Response(
                    {'error': 'Only the event host can log emails for this event'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        template_id = data.get('template_id') or data.get('templateId')
        template_uuid = None
        if template_id:
            try:
                template_uuid = uuid.UUID(str(template_id))
            except (ValueError, TypeError):
                return Response({'error': 'Invalid template_id'}, status=status.HTTP_400_BAD_REQUEST)

        log = EmailLog.objects.create(
            event=event,
            guest=guest,
            recipient=recipient,
            subject=subject,
            email_type=email_type,
            status=data.get('status') or 'pending',
            provider=data.get('provider') or 'acs',
            template_id=template_uuid,
            template_body=data.get('template_body') or data.get('templateBody'),
        )
        return Response({'email_log': _serialize(log)}, status=status.HTTP_201_CREATED)


class EmailLogDetailView(SessionAuthMixin, APIView):
    """GET/PUT /api/email-logs/:id/."""

    def get(self, request, log_id):
        log = _log(log_id)
        if log is None:
            return Response({'error': 'Email log not found'}, status=status.HTTP_404_NOT_FOUND)
        if log.event_id and not _host(log.event, request.user):
            return Response(
                {'error': 'Only the event host can view this email log'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response({'email_log': _serialize(log)})

    def put(self, request, log_id):
        log = _log(log_id)
        if log is None:
            return Response({'error': 'Email log not found'}, status=status.HTTP_404_NOT_FOUND)
        if log.event_id and not _host(log.event, request.user):
            return Response(
                {'error': 'Only the event host can update this email log'},
                status=status.HTTP_403_FORBIDDEN,
            )

        data = request.data
        if 'status' in data:
            log.status = data['status']
        if 'resend_email_id' in data or 'resendEmailId' in data:
            log.resend_email_id = data.get('resend_email_id', data.get('resendEmailId'))
        if 'error_message' in data or 'errorMessage' in data:
            log.error_message = data.get('error_message', data.get('errorMessage'))
        for field in DATETIME_FIELDS:
            camel = ''.join(
                [field.split('_')[0]] + [part.title() for part in field.split('_')[1:]]
            )
            if field in data or camel in data:
                raw = data.get(field, data.get(camel))
                parsed = _parse_datetime(raw)
                if raw not in (None, '') and parsed is None:
                    return Response(
                        {'error': f'Invalid {field}'}, status=status.HTTP_400_BAD_REQUEST
                    )
                setattr(log, field, parsed)
        if 'webhook_data' in data or 'webhookData' in data:
            value = data.get('webhook_data', data.get('webhookData'))
            log.webhook_data = value if isinstance(value, dict) else {}

        log.save()
        return Response({'email_log': _serialize(log)})


class EmailAnalyticsView(SessionAuthMixin, APIView):
    """GET /api/email-logs/analytics/event/?eventId= — counts by status."""

    def get(self, request):
        event_id = request.query_params.get('eventId') or request.query_params.get('event_id')
        if not event_id:
            return Response(
                {'error': 'Missing eventId query parameter'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        event = _event(event_id)
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        if not _host(event, request.user):
            return Response(
                {'error': 'Only the event host can view analytics for this event'},
                status=status.HTTP_403_FORBIDDEN,
            )

        logs = list(EmailLog.objects.filter(event=event).values('status'))
        statuses = [row['status'] for row in logs]
        analytics = {
            'total': len(statuses),
            'sent': sum(
                1 for value in statuses if value in ('sent', 'delivered', 'opened', 'clicked')
            ),
            'delivered': sum(
                1 for value in statuses if value in ('delivered', 'opened', 'clicked')
            ),
            'opened': sum(1 for value in statuses if value in ('opened', 'clicked')),
            'clicked': sum(1 for value in statuses if value == 'clicked'),
            'bounced': sum(1 for value in statuses if value == 'bounced'),
            'failed': sum(1 for value in statuses if value == 'failed'),
            'pending': sum(1 for value in statuses if value == 'pending'),
        }
        return Response({'analytics': analytics})
