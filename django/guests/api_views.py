from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import Guest
from serializers.guest_serializer import GuestSerializer

class GuestViewSet(viewsets.ModelViewSet):
    queryset = Guest.objects.all()
    serializer_class = GuestSerializer
    permission_classes = [IsAuthenticated]
    
    @action(detail=True, methods=['post'])
    def rsvp(self, request, pk=None):
        guest = self.get_object()
        status_value = request.data.get('status')
        if guest.rsvp(status_value):
            serializer = self.get_serializer(guest)
            return Response(serializer.data)
        return Response({'error': 'Invalid RSVP status'}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def check_in(self, request, pk=None):
        guest = self.get_object()
        if guest.check_in():
            serializer = self.get_serializer(guest)
            return Response(serializer.data)
        return Response({'error': 'Already checked in'}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'])
    def invite(self, request):
        event_id = request.data.get('event_id')
        email = request.data.get('email')
        name = request.data.get('name', '')
        
        from events.models import Event
        try:
            event = Event.objects.get(id=event_id, host=request.user)
            normalized_email = email.lower().strip()
            
            guest, created = Guest.objects.get_or_create(
                event=event,
                normalized_email=normalized_email,
                defaults={'name': name, 'email': email}
            )
            
            serializer = self.get_serializer(guest)
            return Response(serializer.data)
        except Event.DoesNotExist:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
