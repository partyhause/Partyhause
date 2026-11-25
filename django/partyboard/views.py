from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.contrib.auth.decorators import login_required
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.db import transaction
from django.utils import timezone
from events.models import Event
from guests.models import Guest
from .models import PartyBoardSticky, PartyBoardStickyVote, PartyBoardTask
import json


def get_event_access(event, user):
    if not event:
        return {'exists': False}
    is_host = str(event.host_id) == str(user.id) if user else False
    is_public = event.is_public or event.privacy == 'public'
    is_guest = False
    if user and user.email:
        try:
            guest = Guest.objects.filter(event=event, email__iexact=user.email).first()
            is_guest = guest is not None
        except Exception:
            pass
    return {
        'exists': True,
        'is_host': is_host,
        'is_co_host': False,
        'is_guest': is_guest,
        'is_public': is_public,
        'host_id': event.host_id
    }


def can_read_event(access):
    return access['exists'] and (access['is_public'] or access['is_host'] or access['is_guest'])


def can_edit_event(access):
    return access['exists'] and (access['is_host'] or False)


# ----- PartyBoardSticky -----

class IndexStickiesView(APIView):
    permission_classes = [AllowAny]
    def get(self, request):
        try:
            user = request.user if request.user.is_authenticated else None
            event_id = request.query_params.get('eventId')
            session_id = request.query_params.get('sessionId')
            if not event_id:
                return Response({'error': 'eventId required'}, status=status.HTTP_400_BAD_REQUEST)
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
            access = get_event_access(event, user)
            if not can_read_event(access):
                return Response({'error': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)
            stickies = PartyBoardSticky.objects.filter(event_id=event_id)
            if session_id:
                stickies = stickies.filter(session_id=session_id)
            data = []
            for s in stickies:
                voted = user and PartyBoardStickyVote.objects.filter(sticky=s, user_id=user.id).exists()
                data.append({
                    'id': str(s.id),
                    'event': str(s.event_id),
                    'session_id': str(s.session_id) if s.session_id else None,
                    'type': s.type,
                    'position_x': s.position_x,
                    'position_y': s.position_y,
                    'width': s.width,
                    'height': s.height,
                    'rotation': s.rotation,
                    'z_index': s.z_index,
                    'category': s.category,
                    'data': s.data,
                    'creator': str(s.creator_id) if s.creator else None,
                    'created_at': s.created_at.isoformat(),
                    'user_has_voted': voted,
                })
            return Response({'stickies': data, 'count': len(data)})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def post(self, request):
        try:
            event_id = request.data.get('event_id')
            if not event_id:
                return Response({'error': 'event_id required'}, status=status.HTTP_400_BAD_REQUEST)
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
            user = request.user if request.user.is_authenticated else None
            access = get_event_access(event, user)
            if not can_edit_event(access):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
            sticky = PartyBoardSticky.objects.create(
                event_id=event_id,
                session_id=request.data.get('session_id'),
                type=request.data.get('type', 'note'),
                position_x=request.data.get('position_x', 0),
                position_y=request.data.get('position_y', 0),
                width=request.data.get('width', 200),
                height=request.data.get('height', 200),
                rotation=request.data.get('rotation'),
                category=request.data.get('category'),
                data=request.data.get('data', {}),
                creator_id=user.id if user else None,
            )
            return Response({'id': str(sticky.id)}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class CreateStickyView(APIView):
    permission_classes = [AllowAny]
    def post(self, request):
        try:
            event_id = request.data.get('event_id')
            if not event_id:
                return Response({'error': 'event_id required'}, status=status.HTTP_400_BAD_REQUEST)
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
            user = request.user if request.user.is_authenticated else None
            access = get_event_access(event, user)
            if not can_edit_event(access):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
            sticky = PartyBoardSticky.objects.create(
                event_id=event_id,
                session_id=request.data.get('session_id'),
                type=request.data.get('type', 'note'),
                position_x=request.data.get('position_x', 0),
                position_y=request.data.get('position_y', 0),
                width=request.data.get('width', 200),
                height=request.data.get('height', 200),
                rotation=request.data.get('rotation'),
                category=request.data.get('category'),
                data=request.data.get('data', {}),
                creator_id=user.id if user else None,
            )
            return Response({'id': str(sticky.id)}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class UpdateStickyPositionView(APIView):
    permission_classes = [AllowAny]
    def patch(self, request, sticky_id):
        try:
            sticky = PartyBoardSticky.objects.filter(id=sticky_id).first()
            if not sticky:
                return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)
            event = sticky.event
            user = request.user if request.user.is_authenticated else None
            access = get_event_access(event, user)
            if not can_edit_event(access):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
            if 'position_x' in request.data:
                sticky.position_x = request.data['position_x']
            if 'position_y' in request.data:
                sticky.position_y = request.data['position_y']
            if 'z_index' in request.data:
                sticky.z_index = request.data['z_index']
            sticky.save()
            return Response({'id': str(sticky.id), 'position_x': sticky.position_x, 'position_y': sticky.position_y, 'z_index': sticky.z_index})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class UpdateStickyVoteView(APIView):
    permission_classes = [AllowAny]
    def patch(self, request, sticky_id):
        try:
            sticky = PartyBoardSticky.objects.filter(id=sticky_id).first()
            if not sticky:
                return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)
            event = sticky.event
            user = request.user if request.user.is_authenticated else None
            access = get_event_access(event, user)
            if not can_edit_event(access):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
            if request.data.get('status') == 'up':
                PartyBoardStickyVote.objects.filter(sticky=sticky, user_id=user.id if user else None).delete()
                PartyBoardStickyVote.objects.get_or_create(sticky=sticky, user_id=user.id if user else None, defaults={'vote_direction': 'up'})
            elif request.data.get('status') == 'down':
                PartyBoardStickyVote.objects.filter(sticky=sticky, user_id=user.id if user else None).delete()
                PartyBoardStickyVote.objects.get_or_create(sticky=sticky, user_id=user.id if user else None, defaults={'vote_direction': 'down'})
            up = PartyBoardStickyVote.objects.filter(sticky=sticky, vote_direction='up').count()
            down = PartyBoardStickyVote.objects.filter(sticky=sticky, vote_direction='down').count()
            user_vote = None
            if user:
                v = PartyBoardStickyVote.objects.filter(sticky=sticky, user_id=user.id).first()
                user_vote = v.vote_direction if v else None
            return Response({'up_votes': up, 'down_votes': down, 'your_vote': user_vote})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class CreateTaskFromStickyView(APIView):
    permission_classes = [AllowAny]
    def post(self, request, sticky_id):
        try:
            sticky = PartyBoardSticky.objects.filter(id=sticky_id).first()
            if not sticky:
                return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)
            event = sticky.event
            user = request.user if request.user.is_authenticated else None
            access = get_event_access(event, user)
            if not can_edit_event(access):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
            title = request.data.get('title') or f'Task from sticky {sticky_id}'
            task, created = PartyBoardTask.objects.get_or_create(
                sticky=sticky,
                defaults={'title': title, 'description': request.data.get('description'), 'assignee_id': user.id if user else None}
            )
            return Response({'id': str(task.id), 'title': task.title, 'description': task.description, 'completed': task.completed, 'created': created})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class IndexTasksView(APIView):
    permission_classes = [AllowAny]
    def get(self, request):
        try:
            event_id = request.query_params.get('eventId')
            if not event_id:
                return Response({'error': 'eventId required'}, status=status.HTTP_400_BAD_REQUEST)
            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
            tasks = PartyBoardTask.objects.filter(sticky__event_id=event_id)
            data = []
            for t in tasks:
                voted = False
                if user := request.user if request.user.is_authenticated else None:
                    voted = PartyBoardStickyVote.objects.filter(sticky=t.sticky, user_id=user.id).exists()
                data.append({
                    'id': str(t.id),
                    'sticky_id': str(t.sticky_id),
                    'title': t.title,
                    'description': t.description,
                    'assignee': str(t.assignee_id) if t.assignee else None,
                    'completed': t.completed,
                    'due_date': t.due_date.isoformat() if t.due_date else None,
                    'created_at': t.created_at.isoformat(),
                    'user_has_voted': voted,
                })
            return Response({'tasks': data, 'count': len(data)})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DeleteStickyView(APIView):
    permission_classes = [AllowAny]
    def delete(self, request, sticky_id):
        try:
            sticky = PartyBoardSticky.objects.filter(id=sticky_id).first()
            if not sticky:
                return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)
            event = sticky.event
            user = request.user if request.user.is_authenticated else None
            access = get_event_access(event, user)
            if access.is_host != True:
                return Response({'error': 'Only author can delete'}, status=status.HTTP_403_FORBIDDEN)
            sticky.delete()
            return Response({'status': 'deleted'})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)