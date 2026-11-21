from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import Poll, PollOption, PollVote
from serializers.poll_serializer import PollSerializer
from django.utils import timezone

class PollViewSet(viewsets.ModelViewSet):
    queryset = Poll.objects.all()
    serializer_class = PollSerializer
    permission_classes = [IsAuthenticated]
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
    @action(detail=True, methods=['post'])
    def vote(self, request, pk=None):
        poll = self.get_object()
        
        if not poll.is_active:
            return Response({'error': 'Poll is not active'}, status=status.HTTP_400_BAD_REQUEST)
        
        option_id = request.data.get('option_id')
        try:
            option = PollOption.objects.get(id=option_id, poll=poll)
        except PollOption.DoesNotExist:
            return Response({'error': 'Option not found'}, status=status.HTTP_404_NOT_FOUND)
        
        # Handle single-choice
        if poll.poll_type == 'single-choice':
            PollVote.objects.filter(poll=poll, user=request.user).delete()
        
        vote, created = PollVote.objects.get_or_create(
            poll=poll,
            user=request.user,
            option=option
        )
        
        # Check consensus
        poll.check_consensus()
        
        serializer = self.get_serializer(poll)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        poll = self.get_object()
        from events.models import Event
        event = Event.objects.get(id=poll.event_id)
        
        if request.user != event.host and request.user != poll.created_by:
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        
        poll.status = 'closed'
        poll.closed_at = timezone.now()
        poll.save()
        
        serializer = self.get_serializer(poll)
        return Response(serializer.data)
