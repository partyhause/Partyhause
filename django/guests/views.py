from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.db import transaction
from django.utils import timezone
from .models import Guest
from events.models import Event


def can_manage_guests(event, user):
    return event.host_id == str(user.id)


def can_invite_guests(event, user):
    return event.host_id == str(user.id)


def is_own_guest_record(guest, user):
    if not user:
        return False
    return (guest.user_id == str(user.id) or
            (user.email and guest.email.lower() == user.email.lower()))


class IndexGuestsView(APIView):
    """GET /api/guests/ — List guests or get single guest"""
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            user = request.user if request.user.is_authenticated else None
            event_id = request.query_params.get('eventId')
            guest_id = request.query_params.get('id')

            if guest_id:
                # Get single guest by id
                guest = Guest.objects.filter(id=guest_id).first()
                if not guest:
                    return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)

                # RLS parity: hosts/co-hosts see any guest of their event;
                # a guest may read their OWN record.
                if user and not (
                    str(guest.event.host_id) == str(user.id) or
                    (user.email and guest.email.lower() == user.email.lower())
                ):
                    event = Event.objects.filter(id=guest.event_id).first()
                    if not event or not can_manage_guests(event, user):
                        return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)

                data = {
                    'id': str(guest.id),
                    'event_id': str(guest.event.id) if guest.event else None,
                    'name': guest.name,
                    'email': guest.email,
                    'normalized_email': guest.normalized_email,
                    'rsvp_status': guest.rsvp_status,
                    'checked_in': guest.checked_in,
                    'checked_in_at': guest.checked_in_at.isoformat() if guest.checked_in_at else None,
                    'user_id': str(guest.user_id) if guest.user_id else None,
                    'created_at': guest.created_at.isoformat()
                }
                return Response({'guest': data})

            if event_id:
                event = Event.objects.filter(id=event_id).first()
                if not event:
                    return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

                if user:
                    if not (event.host_id == str(user.id) or
                            (user.email and Guest.objects.filter(event=event, email__iexact=user.email).exists())):
                        pass

                guests = Guest.objects.filter(event_id=event_id)
            else:
                guests = Guest.objects.all()

            data = [{
                'id': str(g.id),
                'event_id': str(g.event.id) if g.event else None,
                'name': g.name,
                'email': g.email,
                'normalized_email': g.normalized_email,
                'rsvp_status': g.rsvp_status,
                'checked_in': g.checked_in,
                'checked_in_at': g.checked_in_at.isoformat() if g.checked_in_at else None,
                'user_id': str(g.user_id) if g.user_id else None,
                'created_at': g.created_at.isoformat()
            } for g in guests]

            accepted = sum(1 for g in data if g['rsvp_status'] in ['accepted', 'confirmed'])
            declined = sum(1 for g in data if g['rsvp_status'] == 'declined')
            pending = sum(1 for g in data if g['rsvp_status'] == 'pending')

            return Response({
                'guests': data,
                'stats': {
                    'total': len(data),
                    'accepted': accepted,
                    'declined': declined,
                    'pending': pending,
                },
                'count': len(data)
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class CreateGuestView(APIView):
    """POST /api/guests/ — Create guest"""
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

            if not can_invite_guests(event, request.user if request.user.is_authenticated else None):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            # Check capacity
            if event.max_guests:
                accepted_count = Guest.objects.filter(event=event, rsvp_status__in=['accepted', 'confirmed']).count()
                if accepted_count >= event.max_guests:
                    return Response({'error': 'Event at capacity'}, status=status.HTTP_400_BAD_REQUEST)

            guest = Guest.objects.create(
                event=event,
                name=data.get('name'),
                email=data.get('email'),
                rsvp_status=data.get('rsvp_status', 'pending'),
                user_id=data.get('user_id')
            )

            # Send the invitation email (ACS primary, Resend fallback).
            try:
                from guests.email_service import GuestInvitationService
                GuestInvitationService(event).send_invitation(guest)
            except Exception as exc:  # noqa: BLE001
                import logging
                logging.getLogger(__name__).error(
                    'Invitation email failed for %s: %s', data.get('email'), exc
                )

            return Response({
                'id': str(guest.id),
                'name': guest.name,
                'email': guest.email,
                'rsvp_status': guest.rsvp_status,
                'qr_code': f'partyhause://checkin/{event_id}/{guest.id}'
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class UpdateGuestView(APIView):
    """PUT /api/guests/:id — Update guest"""
    permission_classes = [AllowAny]

    def put(self, request, guest_id):
        try:
            guest = Guest.objects.filter(id=guest_id).first()
            if not guest:
                return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)

            event = guest.event
            can_manage = can_manage_guests(event, request.user if request.user.is_authenticated else None)
            is_own = is_own_guest_record(guest, request.user if request.user.is_authenticated else None)

            if not (can_manage or is_own):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            data = request.data

            # Handle RSVP update
            if 'rsvp_status' in data:
                new_status = data['rsvp_status']
                if new_status in ['accepted', 'confirmed', 'declined', 'maybe', 'pending']:
                    if new_status in ['accepted', 'confirmed']:
                        if event.max_guests:
                            accepted_count = Guest.objects.filter(event=event, rsvp_status__in=['accepted', 'confirmed']).exclude(id=guest.id).count()
                            if accepted_count >= event.max_guests:
                                return Response({'error': 'Event at capacity'}, status=status.HTTP_400_BAD_REQUEST)
                    guest.rsvp_status = new_status

            if 'checked_in' in data and can_manage:
                guest.checked_in = data['checked_in']
                if data['checked_in']:
                    guest.checked_in_at = timezone.now()

            guest.save()

            return Response({
                'id': str(guest.id),
                'rsvp_status': guest.rsvp_status,
                'checked_in': guest.checked_in
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, guest_id):
        """DELETE /api/guests/:id — Remove guest"""
        try:
            guest = Guest.objects.filter(id=guest_id).first()
            if not guest:
                return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)

            event = guest.event
            if not can_manage_guests(event, request.user if request.user.is_authenticated else None):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            guest.delete()
            return Response({'status': 'deleted'})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class BulkCreateGuestsView(APIView):
    """POST /api/guests/bulk — Bulk create guests"""
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            data = request.data
            event_id = data.get('event_id')
            guests_data = data.get('guests', [])

            if not event_id:
                return Response({'error': 'event_id required'}, status=status.HTTP_400_BAD_REQUEST)

            event = Event.objects.filter(id=event_id).first()
            if not event:
                return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

            if not request.user.is_authenticated or not can_invite_guests(event, request.user):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            created = []
            errors = []

            for guest_data in guests_data:
                try:
                    guest = Guest.objects.create(
                        event=event,
                        name=guest_data.get('name'),
                        email=guest_data.get('email'),
                        rsvp_status='pending'
                    )
                    created.append({'id': str(guest.id), 'email': guest.email})
                except Exception as e:
                    errors.append({'email': guest_data.get('email'), 'error': str(e)})

            return Response({
                'created': len(created),
                'errors': len(errors),
                'guests': created
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class UpdateRSVPView(APIView):
    """POST /api/guests/:id/rsvp — Update RSVP"""
    permission_classes = [AllowAny]

    def post(self, request, guest_id):
        try:
            guest = Guest.objects.filter(id=guest_id).first()
            if not guest:
                return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)

            event = guest.event
            new_status = request.data.get('status')

            if new_status not in ['accepted', 'confirmed', 'declined', 'maybe', 'pending']:
                return Response({'error': 'Invalid RSVP status'}, status=status.HTTP_400_BAD_REQUEST)

            # Capacity check on accept/confirm
            if new_status in ['accepted', 'confirmed']:
                if event.max_guests:
                    accepted_count = Guest.objects.filter(event=event, rsvp_status__in=['accepted', 'confirmed']).exclude(id=guest.id).count()
                    if accepted_count >= event.max_guests:
                        return Response({'error': 'Event at capacity'}, status=status.HTTP_400_BAD_REQUEST)

            guest.rsvp_status = new_status
            guest.rsvp_responded_at = timezone.now()
            guest.save()

            return Response({
                'id': str(guest.id),
                'rsvp_status': guest.rsvp_status,
                'rsvp_responded_at': guest.rsvp_responded_at.isoformat() if guest.rsvp_responded_at else None
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class CheckInGuestView(APIView):
    """POST /api/guests/:id/check-in — Check in guest"""
    permission_classes = [AllowAny]

    def post(self, request, guest_id):
        try:
            guest = Guest.objects.filter(id=guest_id).first()
            if not guest:
                return Response({'error': 'Guest not found'}, status=status.HTTP_404_NOT_FOUND)

            event = guest.event
            if not can_manage_guests(event, request.user if request.user.is_authenticated else None):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

            guest.checked_in = True
            guest.checked_in_at = timezone.now()
            guest.save()

            return Response({
                'id': str(guest.id),
                'checked_in': guest.checked_in,
                'checked_in_at': guest.checked_in_at.isoformat() if guest.checked_in_at else None
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
