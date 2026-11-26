from datetime import datetime

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin
from events.models import Event
from events.views import EventAccess

from .models import TimelineBlock

BLOCK_TYPES = {choice[0] for choice in TimelineBlock.BLOCK_TYPES}


def _event(value):
    try:
        return Event.objects.filter(id=value).first()
    except (ValueError, TypeError):
        return None


def _block(value):
    try:
        return TimelineBlock.objects.select_related('event').filter(id=value).first()
    except (ValueError, TypeError):
        return None


def _parse_start(value):
    if value in (None, ''):
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = parse_datetime(str(value))
        if parsed is None:
            date_only = parse_date(str(value))
            if date_only is not None:
                parsed = datetime.combine(date_only, datetime.min.time())
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _payload(block):
    return {
        'id': str(block.id),
        'event_id': str(block.event_id),
        'label': block.label,
        'description': block.description,
        'start_time': block.start_time.isoformat(),
        'duration': block.duration,
        'type': block.type,
        'host_notes': block.host_notes,
        'guest_visible': block.guest_visible,
        'notify_before': block.notify_before,
        'location': block.location,
        'assigned_to': block.assigned_to or [],
        'order_index': block.order_index,
        'created_at': block.created_at.isoformat(),
        'updated_at': block.updated_at.isoformat(),
    }


def _as_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')


def _as_int(value, field, default=None, minimum=None):
    if value in (None, ''):
        return default, None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None, f'{field} must be a number'
    if minimum is not None and parsed < minimum:
        return None, f'{field} must be at least {minimum}'
    return parsed, None


def _assigned_to(value):
    if value in (None, ''):
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return [str(value)]


class TimelineEventView(SessionAuthMixin, APIView):
    """GET/PUT/DELETE /api/timeline/:id/.

    The client addresses the schedule by event id for a read and by block id
    for a write, and both are UUIDs in the same path position. One view
    dispatches on the method; two URL patterns would make PUT/DELETE resolve
    to the read view and answer 405.
    """

    ALLOW_ANONYMOUS = True

    def get(self, request, item_id):
        event = _event(item_id)
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(event, request.user)
        if not access.can_read():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        blocks = TimelineBlock.objects.filter(event=event)
        if not access.can_edit():
            blocks = blocks.filter(guest_visible=True)

        data = [_payload(block) for block in blocks]
        return Response({'blocks': data, 'count': len(data)})

    def put(self, request, item_id):
        block = _block(item_id)
        if block is None:
            return Response({'error': 'Timeline block not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(block.event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        data = request.data
        if 'label' in data:
            label = (data.get('label') or '').strip()
            if not label:
                return Response({'error': 'label cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
            block.label = label
        if 'startTime' in data or 'start_time' in data:
            start_time = _parse_start(data.get('startTime') or data.get('start_time'))
            if start_time is None:
                return Response(
                    {'error': 'startTime must be an ISO-8601 datetime'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            block.start_time = start_time
        if 'duration' in data:
            duration, error = _as_int(data.get('duration'), 'duration', minimum=1)
            if error:
                return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
            block.duration = duration
        if 'type' in data:
            if data['type'] not in BLOCK_TYPES:
                return Response(
                    {'error': f"type must be one of {sorted(BLOCK_TYPES)}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            block.type = data['type']
        if 'description' in data:
            block.description = data.get('description')
        if 'hostNotes' in data or 'host_notes' in data:
            block.host_notes = data.get('hostNotes', data.get('host_notes'))
        if 'guestVisible' in data or 'guest_visible' in data:
            block.guest_visible = _as_bool(
                data.get('guestVisible', data.get('guest_visible')), default=True
            )
        if 'notifyBefore' in data or 'notify_before' in data:
            notify_before, error = _as_int(
                data.get('notifyBefore', data.get('notify_before')),
                'notifyBefore',
                default=None,
                minimum=0,
            )
            if error:
                return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
            block.notify_before = notify_before
        if 'location' in data:
            block.location = data.get('location')
        if 'assignedTo' in data or 'assigned_to' in data:
            block.assigned_to = _assigned_to(data.get('assignedTo', data.get('assigned_to')))
        if 'orderIndex' in data or 'order_index' in data:
            order_index, error = _as_int(
                data.get('orderIndex', data.get('order_index')), 'orderIndex', default=0
            )
            if error:
                return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
            block.order_index = order_index

        block.save()
        return Response({'block': _payload(block), 'success': True})

    def delete(self, request, item_id):
        block = _block(item_id)
        if block is None:
            return Response({'error': 'Timeline block not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(block.event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        block.delete()
        return Response({'success': True})


class TimelineCreateView(SessionAuthMixin, APIView):
    """POST /api/timeline/ — create a block."""

    def post(self, request):
        data = request.data
        event = _event(data.get('eventId') or data.get('event_id'))
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        label = (data.get('label') or '').strip()
        start_time = _parse_start(data.get('startTime') or data.get('start_time'))
        duration, error = _as_int(data.get('duration'), 'duration', minimum=1)
        block_type = data.get('type') or 'activity'

        if not label:
            return Response({'error': 'label is required'}, status=status.HTTP_400_BAD_REQUEST)
        if start_time is None:
            return Response(
                {'error': 'startTime must be an ISO-8601 datetime'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if error:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
        if block_type not in BLOCK_TYPES:
            return Response(
                {'error': f"type must be one of {sorted(BLOCK_TYPES)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        order_index, error = _as_int(
            data.get('orderIndex', data.get('order_index')), 'orderIndex', default=0
        )
        if error:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        notify_before, error = _as_int(
            data.get('notifyBefore', data.get('notify_before')),
            'notifyBefore',
            default=None,
            minimum=0,
        )
        if error:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        block = TimelineBlock.objects.create(
            event=event,
            label=label,
            description=data.get('description'),
            start_time=start_time,
            duration=duration,
            type=block_type,
            host_notes=data.get('hostNotes', data.get('host_notes')),
            guest_visible=_as_bool(
                data.get('guestVisible', data.get('guest_visible')), default=True
            ),
            notify_before=notify_before,
            location=data.get('location'),
            assigned_to=_assigned_to(data.get('assignedTo', data.get('assigned_to'))),
            order_index=order_index,
        )
        return Response(
            {'block': _payload(block), 'success': True},
            status=status.HTTP_201_CREATED,
        )
