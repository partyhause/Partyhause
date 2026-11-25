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
        custom_message = request.data.get('custom_message', '')

        from events.models import Event
        try:
            event = Event.objects.get(id=event_id, host=request.user)
        except Event.DoesNotExist:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

        normalized_email = email.lower().strip()

        guest, created = Guest.objects.get_or_create(
            event=event,
            normalized_email=normalized_email,
            defaults={'name': name, 'email': email}
        )

        # Send the invitation email (verification/reset/invite all route through
        # the configured backend: ACS primary, Resend fallback).
        try:
            from guests.email_service import GuestInvitationService
            GuestInvitationService(event).send_invitation(guest, custom_message)
        except Exception as exc:  # noqa: BLE001
            # Do not fail the invite because mail failed; record and report.
            import logging
            logging.getLogger(__name__).error(
                'Invitation email failed for %s: %s', email, exc
            )

        serializer = self.get_serializer(guest)
        return Response(serializer.data)
