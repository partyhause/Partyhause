import uuid
from decimal import Decimal, InvalidOperation

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.session_auth import SessionAuthMixin
from events.models import Event
from events.views import EventAccess

from .models import PartyBoardSticky, PartyBoardStickyVote, PartyBoardTask

STICKY_TYPES = {'note', 'idea', 'checklist', 'link', 'cost', 'image'}
TASK_STATUSES = {'open', 'done'}
TASK_PRIORITIES = {'low', 'medium', 'high', 'critical'}


def _uuid(value):
    if value in (None, ''):
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _event(value):
    event_uuid = _uuid(value)
    if event_uuid is None:
        return None
    return Event.objects.filter(id=event_uuid).first()


def _sticky_payload(sticky, user=None):
    vote_count = sticky.votes.count()
    user_has_voted = False
    if user is not None and getattr(user, 'is_authenticated', False):
        user_has_voted = sticky.votes.filter(user_id=user.id).exists()
    creator_name = ''
    if sticky.creator is not None:
        creator_name = sticky.creator.name or sticky.creator.email
    return {
        'id': str(sticky.id),
        'event_id': str(sticky.event_id),
        # `event` is retained for older callers that read the flat field.
        'event': str(sticky.event_id),
        'session_id': str(sticky.session_id) if sticky.session_id else None,
        'type': sticky.type,
        'position': {'x': sticky.position_x, 'y': sticky.position_y},
        'size': {'width': sticky.width, 'height': sticky.height},
        'position_x': sticky.position_x,
        'position_y': sticky.position_y,
        'width': sticky.width,
        'height': sticky.height,
        'rotation': sticky.rotation,
        'z_index': sticky.z_index,
        'category': sticky.category,
        'data': sticky.data,
        'reaction_count': vote_count,
        'user_has_voted': user_has_voted,
        'created_by': str(sticky.creator_id) if sticky.creator_id else None,
        'created_by_name': creator_name,
        'creator': str(sticky.creator_id) if sticky.creator_id else None,
        'created_at': sticky.created_at.isoformat(),
        'updated_at': sticky.updated_at.isoformat(),
    }


def _task_payload(task):
    created_by_name = ''
    if task.created_by is not None:
        created_by_name = task.created_by.name or task.created_by.email
    return {
        'id': str(task.id),
        'event_id': str(task.event_id),
        'sticky_id': str(task.sticky_id) if task.sticky_id else None,
        'title': task.title,
        'description': task.description,
        'assignee_id': str(task.assignee_id) if task.assignee_id else None,
        'assignee': str(task.assignee_id) if task.assignee_id else None,
        'status': task.status,
        'priority': task.priority,
        'estimated_cost': (
            float(task.estimated_cost) if task.estimated_cost is not None else None
        ),
        'actual_cost': float(task.actual_cost) if task.actual_cost is not None else None,
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'completed': task.completed,
        'completed_at': task.completed_at.isoformat() if task.completed_at else None,
        'created_by': str(task.created_by_id) if task.created_by_id else None,
        'created_by_name': created_by_name,
        'created_at': task.created_at.isoformat(),
    }


def _create_sticky(request):
    event = _event(request.data.get('event_id') or request.data.get('eventId'))
    if event is None:
        return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

    access = EventAccess(event, request.user)
    if not access.can_edit():
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    position = request.data.get('position')
    position = position if isinstance(position, dict) else {}
    size = request.data.get('size')
    size = size if isinstance(size, dict) else {}

    try:
        position_x = int(request.data.get('position_x', position.get('x', 0)))
        position_y = int(request.data.get('position_y', position.get('y', 0)))
        width = int(request.data.get('width', size.get('width', 200)))
        height = int(request.data.get('height', size.get('height', 200)))
    except (TypeError, ValueError):
        return Response(
            {'error': 'position and size must be numbers'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    sticky_type = request.data.get('type') or 'note'
    if sticky_type not in STICKY_TYPES:
        return Response({'error': 'Invalid sticky type'}, status=status.HTTP_400_BAD_REQUEST)

    data = request.data.get('data')
    if not isinstance(data, dict):
        data = {}

    sticky = PartyBoardSticky.objects.create(
        event=event,
        session_id=_uuid(request.data.get('session_id')),
        type=sticky_type,
        position_x=position_x,
        position_y=position_y,
        width=width,
        height=height,
        rotation=request.data.get('rotation'),
        z_index=request.data.get('z_index') or 0,
        category=request.data.get('category'),
        data=data,
        creator_id=request.user.id,
    )
    return Response(
        {'sticky': _sticky_payload(sticky, request.user)},
        status=status.HTTP_201_CREATED,
    )


class IndexStickiesView(SessionAuthMixin, APIView):
    """GET/POST /api/partyboard/stickies/ — list or create stickies."""

    ALLOW_ANONYMOUS = True

    def get(self, request):
        event = _event(request.query_params.get('eventId') or request.query_params.get('event_id'))
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(event, request.user)
        if not access.can_read():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        stickies = PartyBoardSticky.objects.filter(event=event).select_related('creator')
        session_id = request.query_params.get('sessionId') or request.query_params.get('session_id')
        if session_id:
            session_uuid = _uuid(session_id)
            if session_uuid is None:
                return Response({'error': 'Invalid sessionId'}, status=status.HTTP_400_BAD_REQUEST)
            stickies = stickies.filter(session_id=session_uuid)

        data = [_sticky_payload(sticky, request.user) for sticky in stickies]
        return Response({'stickies': data, 'count': len(data)})

    def post(self, request):
        return _create_sticky(request)


class CreateStickyView(SessionAuthMixin, APIView):
    """POST /api/partyboard/stickies/create/ — create a sticky."""

    def post(self, request):
        return _create_sticky(request)


class UpdateStickyPositionView(SessionAuthMixin, APIView):
    """PATCH /api/partyboard/stickies/:id/position/ — persist a drag."""

    def patch(self, request, sticky_id):
        sticky = PartyBoardSticky.objects.filter(id=sticky_id).first()
        if sticky is None:
            return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(sticky.event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        position = request.data.get('position')
        position = position if isinstance(position, dict) else {}
        try:
            if 'position_x' in request.data or 'x' in position:
                sticky.position_x = int(request.data.get('position_x', position.get('x')))
            if 'position_y' in request.data or 'y' in position:
                sticky.position_y = int(request.data.get('position_y', position.get('y')))
            if 'z_index' in request.data:
                sticky.z_index = int(request.data['z_index'])
        except (TypeError, ValueError):
            return Response(
                {'error': 'position must contain numeric x and y'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sticky.save(update_fields=['position_x', 'position_y', 'z_index', 'updated_at'])
        return Response(_sticky_payload(sticky, request.user))


class UpdateStickyVoteView(SessionAuthMixin, APIView):
    """PATCH /api/partyboard/stickies/:id/vote/ — toggle the caller's vote.

    The client sends no body and expects `{votes, user_has_voted}`. The old
    implementation read a `vote_direction` column that does not exist, so every
    vote request raised a FieldError.
    """

    def patch(self, request, sticky_id):
        sticky = PartyBoardSticky.objects.filter(id=sticky_id).first()
        if sticky is None:
            return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(sticky.event, request.user)
        if not access.can_read():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        direction = request.data.get('status') or request.data.get('direction')
        if direction == 'down':
            PartyBoardStickyVote.objects.filter(sticky=sticky, user=request.user).delete()
            user_has_voted = False
        elif direction == 'up':
            PartyBoardStickyVote.objects.get_or_create(sticky=sticky, user=request.user)
            user_has_voted = True
        else:
            vote, created = PartyBoardStickyVote.objects.get_or_create(
                sticky=sticky, user=request.user
            )
            if not created:
                vote.delete()
            user_has_voted = created

        return Response(
            {
                'votes': PartyBoardStickyVote.objects.filter(sticky=sticky).count(),
                'user_has_voted': user_has_voted,
            }
        )


class CreateTaskFromStickyView(SessionAuthMixin, APIView):
    """POST /api/partyboard/stickies/:id/convert-to-task/ — commit an idea."""

    def post(self, request, sticky_id):
        sticky = PartyBoardSticky.objects.filter(id=sticky_id).first()
        if sticky is None:
            return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(sticky.event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        data = request.data
        priority = data.get('priority') or 'medium'
        if priority not in TASK_PRIORITIES:
            return Response({'error': 'Invalid priority'}, status=status.HTTP_400_BAD_REQUEST)

        due_date = None
        if data.get('due_date'):
            due_date = parse_datetime(str(data['due_date']))
            if due_date is None:
                return Response({'error': 'Invalid due_date'}, status=status.HTTP_400_BAD_REQUEST)
            if timezone.is_naive(due_date):
                due_date = timezone.make_aware(due_date)

        assignee = None
        if data.get('assignee_id'):
            assignee = User.objects.filter(id=_uuid(data['assignee_id'])).first()
            if assignee is None:
                return Response({'error': 'Assignee not found'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            estimated_cost = (
                Decimal(str(data['estimated_cost'])) if data.get('estimated_cost') not in (None, '') else None
            )
            actual_cost = (
                Decimal(str(data['actual_cost'])) if data.get('actual_cost') not in (None, '') else None
            )
        except (InvalidOperation, TypeError, ValueError):
            return Response({'error': 'Costs must be numbers'}, status=status.HTTP_400_BAD_REQUEST)

        requested_status = data.get('status') or 'open'
        if requested_status not in TASK_STATUSES:
            return Response({'error': 'Invalid task status'}, status=status.HTTP_400_BAD_REQUEST)

        task, created = PartyBoardTask.objects.get_or_create(
            sticky=sticky,
            defaults={
                'event': sticky.event,
                'title': data.get('title') or f'Task from sticky {sticky_id}',
                'description': data.get('description') or sticky.data.get('content'),
                'assignee': assignee,
                'due_date': due_date,
                'priority': priority,
                'estimated_cost': estimated_cost,
                'actual_cost': actual_cost,
                'status': requested_status,
                'completed': requested_status == 'done',
                'completed_at': timezone.now() if requested_status == 'done' else None,
                'created_by': request.user,
            },
        )

        if not created:
            if 'title' in data:
                task.title = data.get('title') or task.title
            if 'description' in data:
                task.description = data.get('description')
            if 'assignee_id' in data:
                task.assignee = assignee
            if 'due_date' in data:
                task.due_date = due_date
            if 'priority' in data:
                task.priority = priority
            if 'estimated_cost' in data:
                task.estimated_cost = estimated_cost
            if 'actual_cost' in data:
                task.actual_cost = actual_cost
            if 'status' in data:
                task.status = requested_status
                task.completed = requested_status == 'done'
                task.completed_at = timezone.now() if requested_status == 'done' else None
            task.save()

        return Response(
            {
                'task_id': str(task.id),
                'status': 'created' if created else 'existing',
                'task': _task_payload(task),
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class IndexTasksView(SessionAuthMixin, APIView):
    """GET /api/partyboard/tasks/ — list an event's committed tasks."""

    ALLOW_ANONYMOUS = True

    def get(self, request):
        event = _event(request.query_params.get('eventId') or request.query_params.get('event_id'))
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(event, request.user)
        if not access.can_read():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        tasks = PartyBoardTask.objects.filter(event=event).select_related(
            'assignee', 'created_by', 'sticky'
        )
        data = [_task_payload(task) for task in tasks]
        return Response({'tasks': data, 'count': len(data)})


class DeleteStickyView(SessionAuthMixin, APIView):
    """DELETE /api/partyboard/stickies/:id/ — delete a sticky."""

    def delete(self, request, sticky_id):
        sticky = PartyBoardSticky.objects.filter(id=sticky_id).first()
        if sticky is None:
            return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(sticky.event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        sticky.delete()
        return Response({'status': 'deleted'})
