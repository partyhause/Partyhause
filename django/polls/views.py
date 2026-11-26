from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin
from events.models import Event
from events.views import EventAccess

from .models import Poll, PollOption, PollVote

POLL_TYPES = {'single-choice', 'multiple-choice', 'ranking'}
ACTIVE_STATUSES = {'active'}


def _event(value):
    try:
        return Event.objects.filter(id=value).first()
    except (ValueError, TypeError):
        return None


def _poll(value):
    try:
        return Poll.objects.select_related('event', 'creator').filter(id=value).first()
    except (ValueError, TypeError):
        return None


def _normalize_type(value):
    raw = str(value or 'single-choice').strip().lower().replace('_', '-')
    aliases = {
        'single': 'single-choice',
        'singlechoice': 'single-choice',
        'multiple': 'multiple-choice',
        'multiplechoice': 'multiple-choice',
        'ranked': 'ranking',
    }
    return aliases.get(raw, raw)


def _option_ids(data):
    raw = data.get('option_ids')
    if raw is None:
        raw = data.get('optionIds')
    if raw is None:
        raw = data.get('option_id') or data.get('optionId')
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return [str(item) for item in raw if item]
    return [str(raw)]


def _serialize(poll, user=None):
    options = list(poll.options.all().order_by('created_at', 'id'))
    votes = list(poll.votes.all())
    by_option = {str(option.id): [] for option in options}
    for vote in votes:
        key = str(vote.option_id)
        if key in by_option and vote.user_id is not None:
            by_option[key].append(str(vote.user_id))

    viewer_id = str(user.id) if getattr(user, 'is_authenticated', False) else None
    total_voters = len({str(vote.user_id) for vote in votes if vote.user_id is not None})

    return {
        'id': str(poll.id),
        'event_id': str(poll.event_id),
        'node_id': poll.node_id,
        'created_by': str(poll.creator_id) if poll.creator_id else None,
        'creator_name': (
            (poll.creator.name or poll.creator.email) if poll.creator_id else ''
        ),
        'question': poll.question,
        'poll_type': poll.poll_type,
        'options': [
            {
                'id': str(option.id),
                'text': option.text,
                'description': option.description,
                'votes': len(by_option[str(option.id)]),
                'voters': by_option[str(option.id)],
                'user_has_voted': (
                    viewer_id is not None and viewer_id in by_option[str(option.id)]
                ),
            }
            for option in options
        ],
        'ends_at': poll.ends_at.isoformat() if poll.ends_at else None,
        'auto_close_on_consensus': poll.auto_close_on_consensus,
        'consensus_threshold': poll.consensus_threshold,
        'status': poll.status,
        'total_votes': len(votes),
        'total_voters': total_voters,
        'created_at': poll.created_at.isoformat(),
        'closed_at': poll.closed_at.isoformat() if poll.closed_at else None,
    }


def _close_if_expired(poll):
    if (
        poll.status == 'active'
        and poll.ends_at is not None
        and poll.ends_at <= timezone.now()
    ):
        poll.status = 'closed'
        poll.closed_at = timezone.now()
        poll.save(update_fields=['status', 'closed_at'])
    return poll


def _maybe_reach_consensus(poll):
    if not poll.auto_close_on_consensus or poll.status != 'active':
        return poll
    votes = list(poll.votes.all())
    voters = {str(vote.user_id) for vote in votes if vote.user_id is not None}
    if not voters:
        return poll
    counts = {}
    for vote in votes:
        counts[str(vote.option_id)] = counts.get(str(vote.option_id), 0) + 1
    leader = max(counts.values()) if counts else 0
    if leader * 100 >= poll.consensus_threshold * len(voters):
        poll.status = 'consensus-reached'
        poll.closed_at = timezone.now()
        poll.save(update_fields=['status', 'closed_at'])
    return poll


class PollListView(SessionAuthMixin, APIView):
    """GET/POST /api/polls/ — list an event's polls or create one."""

    ALLOW_ANONYMOUS = True

    def get(self, request):
        event = _event(request.query_params.get('eventId') or request.query_params.get('event_id'))
        if event is None:
            return Response({'error': 'eventId is required'}, status=status.HTTP_400_BAD_REQUEST)

        access = EventAccess(event, request.user)
        if not access.can_read():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        polls = Poll.objects.filter(event=event).select_related('creator').prefetch_related(
            'options', 'votes'
        )
        data = []
        for poll in polls:
            _close_if_expired(poll)
            data.append(_serialize(poll, request.user))
        return Response({'polls': data, 'count': len(data)})

    def post(self, request):
        data = request.data
        event = _event(data.get('event_id') or data.get('eventId'))
        if event is None:
            return Response({'error': 'event_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        access = EventAccess(event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        question = (data.get('question') or '').strip()
        if not question:
            return Response({'error': 'question is required'}, status=status.HTTP_400_BAD_REQUEST)

        poll_type = _normalize_type(data.get('poll_type') or data.get('pollType'))
        if poll_type not in POLL_TYPES:
            return Response(
                {'error': f"poll_type must be one of {sorted(POLL_TYPES)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_options = data.get('options')
        if not isinstance(raw_options, list):
            return Response(
                {'error': 'options must be a list'}, status=status.HTTP_400_BAD_REQUEST
            )
        options = []
        for raw in raw_options:
            if isinstance(raw, str):
                text = raw.strip()
                description = None
            elif isinstance(raw, dict):
                text = (raw.get('text') or raw.get('label') or '').strip()
                description = raw.get('description')
            else:
                continue
            if text:
                options.append((text, description))
        if len(options) < 2:
            return Response(
                {'error': 'At least two non-empty options are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ends_at = None
        if data.get('ends_at') or data.get('endsAt'):
            from django.utils.dateparse import parse_datetime

            ends_at = parse_datetime(str(data.get('ends_at') or data.get('endsAt')))
            if ends_at is None:
                return Response({'error': 'Invalid ends_at'}, status=status.HTTP_400_BAD_REQUEST)
            if timezone.is_naive(ends_at):
                ends_at = timezone.make_aware(ends_at)

        try:
            threshold = int(data.get('consensus_threshold') or data.get('consensusThreshold') or 70)
        except (TypeError, ValueError):
            return Response(
                {'error': 'consensus_threshold must be a number'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        threshold = max(1, min(100, threshold))

        with transaction.atomic():
            poll = Poll.objects.create(
                event=event,
                node_id=data.get('node_id') or data.get('nodeId'),
                creator=request.user,
                question=question,
                poll_type=poll_type,
                ends_at=ends_at,
                auto_close_on_consensus=bool(
                    data.get('auto_close_on_consensus', data.get('autoCloseOnConsensus', False))
                ),
                consensus_threshold=threshold,
                status='active',
            )
            PollOption.objects.bulk_create(
                [
                    PollOption(poll=poll, text=text, description=description)
                    for text, description in options
                ]
            )

        poll = _poll(poll.id)
        return Response({'poll': _serialize(poll, request.user)}, status=status.HTTP_201_CREATED)


class PollDetailView(SessionAuthMixin, APIView):
    """GET /api/polls/:id/ — read one poll."""

    ALLOW_ANONYMOUS = True

    def get(self, request, poll_id):
        poll = _poll(poll_id)
        if poll is None:
            return Response({'error': 'Poll not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(poll.event, request.user)
        if not access.can_read():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        _close_if_expired(poll)
        return Response({'poll': _serialize(poll, request.user)})


class PollVoteView(SessionAuthMixin, APIView):
    """POST /api/polls/:id/vote/ — cast or replace the caller's vote."""

    def post(self, request, poll_id):
        poll = _poll(poll_id)
        if poll is None:
            return Response({'error': 'Poll not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(poll.event, request.user)
        if not access.can_read():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        _close_if_expired(poll)
        if poll.status != 'active':
            return Response(
                {'error': 'This poll is closed', 'code': 'POLL_CLOSED'},
                status=status.HTTP_409_CONFLICT,
            )

        option_ids = _option_ids(request.data)
        if not option_ids:
            return Response(
                {'error': 'option_ids is required', 'code': 'OPTION_REQUIRED'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if poll.poll_type == 'single-choice' and len(option_ids) != 1:
            return Response(
                {'error': 'single-choice polls accept exactly one option'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        options = list(poll.options.filter(id__in=option_ids))
        if len(options) != len(set(option_ids)):
            return Response(
                {'error': 'One or more options do not belong to this poll'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            PollVote.objects.filter(poll=poll, user=request.user).delete()
            PollVote.objects.bulk_create(
                [
                    PollVote(
                        poll=poll,
                        user=request.user,
                        option=option,
                        rank=index if poll.poll_type == 'ranking' else None,
                    )
                    for index, option in enumerate(options)
                ]
            )
            _maybe_reach_consensus(poll)

        poll = _poll(poll.id)
        return Response({'poll': _serialize(poll, request.user)})


class PollCloseView(SessionAuthMixin, APIView):
    """POST /api/polls/:id/close/ — close a poll (host or co-host)."""

    def post(self, request, poll_id):
        poll = _poll(poll_id)
        if poll is None:
            return Response({'error': 'Poll not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(poll.event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        if poll.status == 'active':
            poll.status = 'closed'
            poll.closed_at = timezone.now()
            poll.save(update_fields=['status', 'closed_at'])

        return Response({'poll': _serialize(poll, request.user)})
