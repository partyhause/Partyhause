from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin
from events.models import Event
from events.views import EventAccess
from guests.models import Guest

from .models import CostSplitRequest, EventCostSummary

SPLIT_STATUSES = {'pending', 'sent', 'paid', 'overdue', 'cancelled', 'refunded'}
ATTENDING = ('accepted', 'confirmed')


def _event(value):
    try:
        return Event.objects.filter(id=value).first()
    except (ValueError, TypeError):
        return None


def _request(value):
    try:
        return (
            CostSplitRequest.objects.select_related('event', 'guest', 'creator')
            .filter(id=value)
            .first()
        )
    except (ValueError, TypeError):
        return None


def _cents(value):
    try:
        return int((Decimal(str(value)) * 100).to_integral_value(rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _money(cents):
    return (Decimal(cents) / Decimal(100)).quantize(Decimal('0.01'))


def _guest_payload(guest):
    if guest is None:
        return None
    return {
        'id': str(guest.id),
        'name': guest.name,
        'email': guest.email,
        'user_id': str(guest.user_id) if guest.user_id else None,
        'rsvp_status': guest.rsvp_status,
    }


def _split_payload(split):
    return {
        'id': str(split.id),
        'event_id': str(split.event_id),
        'guest_id': str(split.guest_id) if split.guest_id else None,
        'guest': _guest_payload(split.guest),
        'amount': float(split.amount),
        'currency': split.currency,
        'description': split.description,
        'status': split.status,
        'payment_method': split.payment_method,
        'payment_reference': split.payment_reference,
        'paid_at': split.paid_at.isoformat() if split.paid_at else None,
        'due_date': split.due_date.isoformat() if split.due_date else None,
        'admin_notes': split.admin_notes,
        'guest_notes': split.guest_notes,
        'created_by': str(split.creator_id) if split.creator_id else None,
        'created_at': split.created_at.isoformat(),
        'updated_at': split.updated_at.isoformat(),
    }


def _summary(event, splits):
    total_event = sum((split.amount for split in splits), Decimal('0'))
    collected = sum(
        (split.amount for split in splits if split.status == 'paid'), Decimal('0')
    )
    pending = sum(
        (
            split.amount
            for split in splits
            if split.status in ('pending', 'sent', 'overdue')
        ),
        Decimal('0'),
    )
    overdue = sum(
        (split.amount for split in splits if split.status == 'overdue'), Decimal('0')
    )
    with_splits = {str(split.guest_id) for split in splits if split.guest_id}
    paid = {
        str(split.guest_id)
        for split in splits
        if split.guest_id and split.status == 'paid'
    }
    pending_guests = {
        str(split.guest_id)
        for split in splits
        if split.guest_id and split.status in ('pending', 'sent', 'overdue')
    }
    return {
        'event_id': str(event.id),
        'total_event_cost': float(total_event),
        'total_collected': float(collected),
        'total_pending': float(pending),
        'total_overdue': float(overdue),
        'guests_with_splits': len(with_splits),
        'guests_paid': len(paid),
        'guests_pending': len(pending_guests),
        'split_enabled': bool(splits),
        'split_method': None,
        'currency': splits[0].currency if splits else 'USD',
        'updated_at': timezone.now().isoformat(),
    }


class CostSplitListView(SessionAuthMixin, APIView):
    """GET/POST /api/cost-split/:eventId/ and /api/cost-split/."""

    def get(self, request, event_id=None):
        event_id = event_id or request.query_params.get('eventId') or request.query_params.get('event_id')
        event = _event(event_id)
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(event, request.user)
        if not access.can_edit():
            return Response(
                {'error': 'Only the event host can manage cost splits'},
                status=status.HTTP_403_FORBIDDEN,
            )

        splits = list(
            CostSplitRequest.objects.filter(event=event)
            .select_related('guest', 'creator')
            .order_by('-created_at')
        )
        return Response(
            {
                'summary': _summary(event, splits),
                'splits': [_split_payload(split) for split in splits],
            }
        )

    def post(self, request):
        data = request.data
        event = _event(data.get('event_id') or data.get('eventId'))
        if event is None:
            return Response({'error': 'event_id required'}, status=status.HTTP_400_BAD_REQUEST)

        access = EventAccess(event, request.user)
        if not access.can_edit():
            return Response(
                {'error': 'Only the event host can manage cost splits'},
                status=status.HTTP_403_FORBIDDEN,
            )

        split_method = data.get('split_method') or data.get('splitMethod')
        if split_method not in ('equal', 'custom', 'percentage'):
            return Response({'error': 'Invalid split_method'}, status=status.HTTP_400_BAD_REQUEST)

        total_cents = _cents(data.get('total_amount') or data.get('totalAmount'))
        if total_cents is None or total_cents <= 0:
            return Response(
                {'error': 'total_amount must be a positive number'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        guests = list(
            Guest.objects.filter(event=event, rsvp_status__in=ATTENDING).order_by(
                'created_at', 'id'
            )
        )
        if not guests:
            return Response(
                {'error': 'No confirmed guests to split costs with'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        splits = []
        if split_method == 'equal':
            base = total_cents // len(guests)
            remainder = total_cents - base * len(guests)
            for guest in guests:
                cents = base + (1 if remainder > 0 else 0)
                if remainder > 0:
                    remainder -= 1
                splits.append((guest, cents))
        else:
            custom = data.get('custom_splits') or data.get('customSplits')
            if not isinstance(custom, dict) or not custom:
                return Response(
                    {'error': 'custom_splits required for custom split method'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            guest_by_id = {str(guest.id): guest for guest in guests}
            sum_cents = 0
            for guest_id, raw_amount in custom.items():
                guest = guest_by_id.get(str(guest_id))
                if guest is None:
                    return Response(
                        {'error': f'Guest {guest_id} is not an attending guest of this event'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                cents = _cents(raw_amount)
                if cents is None or cents <= 0:
                    return Response(
                        {'error': f'custom_splits amount for guest {guest_id} must be positive'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                sum_cents += cents
                splits.append((guest, cents))
            if sum_cents != total_cents:
                return Response(
                    {
                        'error': (
                            'custom_splits must sum to total_amount '
                            f'(expected {_money(total_cents)}, got {_money(sum_cents)})'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        currency = (data.get('currency') or 'USD').upper()
        description = data.get('description') or f'Cost share for {event.name}'
        due_date = None
        if data.get('due_date') or data.get('dueDate'):
            due_date = parse_datetime(str(data.get('due_date') or data.get('dueDate')))
            if due_date is None:
                return Response({'error': 'Invalid due_date'}, status=status.HTTP_400_BAD_REQUEST)
            if timezone.is_naive(due_date):
                due_date = timezone.make_aware(due_date)

        with transaction.atomic():
            created = [
                CostSplitRequest.objects.create(
                    event=event,
                    guest=guest,
                    creator=request.user,
                    amount=_money(cents),
                    currency=currency,
                    description=description,
                    status='pending',
                    due_date=due_date,
                )
                for guest, cents in splits
            ]
            for guest, cents in splits:
                guest.cost_share_enabled = True
                guest.cost_share_amount = _money(cents)
                guest.save(update_fields=['cost_share_enabled', 'cost_share_amount', 'updated_at'])

            summary, _ = EventCostSummary.objects.get_or_create(event=event)
            all_splits = list(CostSplitRequest.objects.filter(event=event))
            summary.total_event_cost = sum((s.amount for s in all_splits), Decimal('0'))
            summary.total_collected = sum(
                (s.amount for s in all_splits if s.status == 'paid'), Decimal('0')
            )
            summary.total_pending = sum(
                (s.amount for s in all_splits if s.status in ('pending', 'sent', 'overdue')),
                Decimal('0'),
            )
            summary.split_enabled = True
            summary.split_method = split_method
            summary.currency = currency
            summary.save()

        return Response(
            {
                'message': 'Cost split requests created',
                'splits': [_split_payload(split) for split in created],
                'total_guests': len(created),
                'total_amount': float(_money(total_cents)),
            },
            status=status.HTTP_201_CREATED,
        )


class CostSplitDetailView(SessionAuthMixin, APIView):
    """GET/PUT/DELETE /api/cost-split/:id/.

    GET treats the id as an event id, matching `GET /api/cost-split/:eventId`;
    PUT and DELETE treat it as a split id. The Express router used the same
    path position for both, so one view dispatches on the method.
    """

    def get(self, request, split_id):
        return CostSplitListView().get(request, event_id=split_id)

    def put(self, request, split_id):
        split = _request(split_id)
        if split is None:
            return Response({'error': 'Cost split not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(split.event, request.user)
        if not access.can_edit():
            return Response(
                {'error': 'Only the event host can manage cost splits'},
                status=status.HTTP_403_FORBIDDEN,
            )

        data = request.data
        if 'status' in data:
            if data['status'] not in SPLIT_STATUSES:
                return Response({'error': 'Invalid status'}, status=status.HTTP_400_BAD_REQUEST)
            split.status = data['status']
            split.paid_at = timezone.now() if split.status == 'paid' else None
        if 'amount' in data:
            cents = _cents(data.get('amount'))
            if cents is None or cents <= 0:
                return Response({'error': 'amount must be positive'}, status=status.HTTP_400_BAD_REQUEST)
            split.amount = _money(cents)
        if 'description' in data:
            split.description = data.get('description')
        if 'payment_method' in data or 'paymentMethod' in data:
            split.payment_method = data.get('payment_method', data.get('paymentMethod'))
        if 'payment_reference' in data or 'paymentReference' in data:
            split.payment_reference = data.get('payment_reference', data.get('paymentReference'))
        if 'due_date' in data or 'dueDate' in data:
            raw = data.get('due_date') or data.get('dueDate')
            if raw in (None, ''):
                split.due_date = None
            else:
                due_date = parse_datetime(str(raw))
                if due_date is None:
                    return Response({'error': 'Invalid due_date'}, status=status.HTTP_400_BAD_REQUEST)
                if timezone.is_naive(due_date):
                    due_date = timezone.make_aware(due_date)
                split.due_date = due_date
        if 'admin_notes' in data or 'adminNotes' in data:
            split.admin_notes = data.get('admin_notes', data.get('adminNotes'))
        if 'guest_notes' in data or 'guestNotes' in data:
            split.guest_notes = data.get('guest_notes', data.get('guestNotes'))

        split.save()
        return Response({'split': _split_payload(split)})

    def delete(self, request, split_id):
        split = _request(split_id)
        if split is None:
            return Response({'error': 'Cost split not found'}, status=status.HTTP_404_NOT_FOUND)

        access = EventAccess(split.event, request.user)
        if not access.can_edit():
            return Response(
                {'error': 'Only the event host can manage cost splits'},
                status=status.HTTP_403_FORBIDDEN,
            )

        split.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
