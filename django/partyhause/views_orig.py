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
from .models import Event
from guests.models import Guest
from events.models import Event as EventModel
import json


# ---- Access control helpers (replicate Express logic) ----

def get_event_access(event, user):
    """Replicate Express getEventAccess logic"""
    if not event:
        return {'exists': False}

    is_host = str(event.host_id) == str(user.id) if user else False
    is_public = event.is_public or event.privacy == 'public'

    # Check if user is guest via email match
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
        'is_co_host': False,  # TODO: check EventCoHost table
        'is_guest': is_guest,
        'is_public': is_public,
        'host_id': event.host_id
    }


def can_read_event(access):
    return access['exists'] and (access['is_public'] or access['is_host'] or access['is_guest'])


def can_edit_event(access):
    return access['exists'] and (access['is_host'] or access['is_co_host'])


def can_delete_event(access):
    return access['exists'] and access['is_host']


def serialize_event(event, access):
    base = {
        'id': str(event.id),
        'name': event.name,
        'title': event.title,
        'description': event.description,
        'start_date': event.start_date.isoformat() if event.start_date else None,
        'end_date': event.end_date.isoformat() if event.end_date else None,
        'location': event.location,
        'location_name': event.location_name,
        'privacy': event.privacy,
        'status': event.status,
        'max_guests': event.max_guests,
        'is_public': event.is_public,
        'host_id': str(event.host_id),
        'created_at': event.created_at.isoformat(),
        'updated_at': event.updated_at.isoformat(),
    }
    can_edit = can_edit_event(access) if access else False
    if can_edit:
        base['capabilities'] = {
            'can_edit': can_edit,
            'can_delete': can_delete_event(access) if access else False,
            'can_view_insights': True
        }
    return base


# ---- DRF Views ----

class EventAccess:
    """Helper to build access dicts in views"""

    def __init__(self, event, user):
        self.event = event
        self.user = user
        if not event:
            self.exists = False
            return

        self.is_host = str(event.host_id) == str(user.id) if user else False
        self.is_public = event.is_public or event.privacy == 'public'

        is_guest = False
        if user and user.email:
            try:
                guest = Guest.objects.filter(event=event, email__iexact=user.email).first()
                is_guest = guest is not None
            except Exception:
                pass

        self.is_guest = is_guest
        self.exists = True
        self.host_id = event.host_id

    def can_read(self):
        return self.exists and (self.is_public or self.is_host or self.is_guest)

    def can_edit(self):
        return self.exists and (self.is_host or False)

    def can_delete(self):
        return self.exists and self.is_host


# ----- PartyBoardSticky -----

class StickySerializer:
    """Simple serializer for sticky data (not ModelSerializer to avoid circular deps)"""

    @staticmethod
    def from_model(sticky, access):
        return {
            'id': str(sticky.id),
            'event': str(sticky.event_id),
            'session_id': str(sticky.session_id) if sticky.session_id else None,
            'type': sticky.type,
            'position_x': sticky.position_x,
            'position_y': sticky.position_y,
            'width': sticky.width,
            'height': sticky.height,
            'rotation': sticky.rotation,
            'z_index': sticky.z_index,
            'category': sticky.category,
            'data': sticky.data,
            'creator': str(sticky.creator_id) if sticky.creator else None,
            'created_at': sticky.created_at.isoformat(),
            'updated_at': sticky.updated_at.isoformat(),
            # caller's vote status
            'user_has_voted': access is not None and sticky.id in [
                v.sticky_id for v in sticky.votes.all()
            ] if hasattr(sticky, 'votes') else False,
        }


class IndexStickiesView(APIView):
    """GET /api/partyboard/stickies?event_id=xxx[&session_id=yyy]"""
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            user = request.user if request.user.is_authenticated else None
            event_id = request.query_params.get('eventId')
            session_id = request.query_params.get('sessionId')

            if not event_id:
                return Response({'error': 'eventId query parameter required'}, status=status.HTTP_400_BAD_REQUEST)

            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            access = EventAccess(event, user)
            if not can_read_event(access):
                return Response({'error': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

            # Load stickies
            from .models import PartyBoardSticky as PBS
            stickies = PBS.objects.filter(event_id=event_id)

            # Filter by session_id if provided
            if session_id:
                stickies = stickies.filter(session_id=session_id)

            # Build response with access per sticky
            sticky_rows = []
            for s in stickies:
                sticky_data = StickySerializer.from_model(s, access)
                sticky_rows.append(sticky_data)

            return Response({
                'stickies': sticky_rows,
                'count': len(sticky_rows)
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class CreateStickyView(APIView):
    """POST /api/partyboard/stickies"""
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            data = request.data
            event_id = data.get('event_id')

            if not event_id:
                return Response({'error': 'event_id required'}, status=status.HTTP_400_BAD_REQUEST)

            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            user = request.user if request.user.is_authenticated else None
            access = EventAccess(event, user)
            if not can_edit_event(access):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            from .models import PartyBoardSticky as PBS

            sticky = PBS.objects.create(
                event_id=event_id,
                session_id=data.get('session_id'),
                type=data.get('type', 'note'),
                position_x=data.get('position_x', 0),
                position_y=data.get('position_y', 0),
                width=data.get('width', 200),
                height=data.get('height', 200),
                rotation=data.get('rotation'),
                category=data.get('category'),
                data=data.get('data', {}),
                creator_id=user.id if user else None,
            )

            return Response({
                'id': str(sticky.id),
                'message': 'Sticky created successfully'
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class UpdateStickyPositionView(APIView):
    """PATCH /api/partyboard/stickies/:id/position"""
    permission_classes = [AllowAny]

    def patch(self, request, sticky_id):
        try:
            from .models import PartyBoardSticky as PBS

            sticky = PBS.objects.filter(id=sticky_id).first()
            if not sticky:
                return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)

            event = sticky.event
            user = request.user if request.user.is_authenticated else None
            access = EventAccess(event, user)

            if not can_edit_event(access):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            data = request.data
            if 'position_x' in data:
                sticky.position_x = data['position_x']
            if 'position_y' in data:
                sticky.position_y = data['position_y']
            if 'z_index' in data:
                sticky.z_index = data['z_index']
            sticky.save()

            return Response({
                'id': str(sticky.id),
                'position_x': sticky.position_x,
                'position_y': sticky.position_y,
                'z_index': sticky.z_index,
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class UpdateStickyVoteView(APIView):
    """PATCH /api/partyboard/stickies/:id/vote: toggle the caller's vote"""
    permission_classes = [AllowAny]

    def patch(self, request, sticky_id):
        try:
            from .models import PartyBoardSticky as PBS
            from .models import PartyBoardStickyVote as PBSV

            sticky = PBS.objects.filter(id=sticky_id).first()
            if not sticky:
                return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)

            event = sticky.event
            user = request.user if request.user.is_authenticated else None
            access = EventAccess(event, user)

            if not can_edit_event(access):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            # Check if user already voted
            existing_vote = PBSV.objects.filter(sticky=sticky, user_id=user.id if user else None).first()

            data = request.data
            new_status = data.get('status')  # 'up' or 'down' or 'none' to remove

            if new_status == 'up' or new_status == 'down':
                if existing_vote:
                    # Toggle: remove existing vote if same user voting again
                    if existing_vote.vote_direction == new_status:
                        existing_vote.delete()
                    else:
                        existing_vote.vote_direction = new_status
                        existing_vote.save()
                else:
                    # Create new vote
                    PBSV.objects.create(
                        sticky=sticky,
                        user_id=user.id if user else None,
                        vote_direction=new_status
                    )
            elif new_status == 'none':
                # Remove vote
                if existing_vote:
                    existing_vote.delete()

            # Count votes
            up_votes = PBSV.objects.filter(sticky=sticky, vote_direction='up').count()
            down_votes = PBSV.objects.filter(sticky=sticky, vote_direction='down').count()

            return Response({
                'sticky_id': str(sticky.id),
                'up_votes': up_votes,
                'down_votes': down_votes,
                'your_vote': new_status if (new_status and (not existing_vote or existing_vote.vote_direction == new_status)) else None,
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class CreateTaskFromStickyView(APIView):
    """POST /api/partyboard/stickies/:id/convert-to-task"""
    permission_classes = [AllowAny]

    def post(self, request, sticky_id):
        try:
            from .models import PartyBoardSticky as PBS
            from .models import PartyBoardTask as PBT

            sticky = PBS.objects.filter(id=sticky_id).first()
            if not sticky:
                return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)

            event = sticky.event
            user = request.user if request.user.is_authenticated else None
            access = EventAccess(event, user)

            if not can_edit_event(access):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            data = request.data
            title = data.get('title') or f'Task from sticky {sticky.id}'

            # Check if task already exists
            task, created = PBT.objects.get_or_create(
                sticky=sticky,
                defaults={
                    'title': title,
                    'description': data.get('description'),
                    'assignee_id': user.id if user else None,
                }
            )

            return Response({
                'id': str(task.id),
                'title': task.title,
                'description': task.description,
                'completed': task.completed,
                'created': created,
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class IndexTasksView(APIView):
    """GET /api/partyboard/tasks?event_id=xxx"""
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            event_id = request.query_params.get('eventId')

            if not event_id:
                return Response({'error': 'eventId query parameter required'}, status=status.HTTP_400_BAD_REQUEST)

            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            from .models import PartyBoardTask as PBT
            tasks = PBT.objects.filter(sticky__event_id=event_id)

            data = [{
                'id': str(t.id),
                'sticky_id': str(t.sticky_id),
                'title': t.title,
                'description': t.description,
                'assignee': str(t.assignee_id) if t.assignee else None,
                'completed': t.completed,
                'due_date': t.due_date.isoformat() if t.due_date else None,
                'created_at': t.created_at.isoformat(),
            } for t in tasks]

            return Response({
                'tasks': data,
                'count': len(data)
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DeleteStickyView(APIView):
    """DELETE /api/partyboard/stickies/:id"""
    permission_classes = [AllowAny]

    def delete(self, request, sticky_id):
        try:
            from .models import PartyBoardSticky as PBS

            sticky = PBS.objects.filter(id=sticky_id).first()
            if not sticky:
                return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)

            event = sticky.event
            user = request.user if request.user.is_authenticated else None
            access = EventAccess(event, user)

            # Only author can delete
            if access.is_host != True:
                return Response({'error': 'Only sticky author can delete'}, status=status.HTTP_403_FORBIDDEN)

            sticky.delete()

            return Response({'status': 'deleted'})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)