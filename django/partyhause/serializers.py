from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Event, Guest


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            'id', 'email', 'name', 'email_verified',
            'account_status', 'token_version',
            'created_at', 'updated_at',
        ]


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = [
            'id', 'host', 'name', 'title', 'description',
            'start_date', 'end_date', 'event_date',
            'location', 'location_name', 'location_address',
            'location_coordinates', 'timezone', 'privacy',
            'status', 'max_guests', 'is_public',
            'invite_image_url', 'spotify_playlist_url',
            'template_type', 'settings', 'template_data',
            'timeline_blocks', 'revision', 'published_at',
            'cancelled_at', 'completed_at',
            'external_event_id', 'external_source', 'external_metadata',
            'place_id', 'created_at', 'updated_at',
        ]


class GuestSerializer(serializers.ModelSerializer):
    class Meta:
        model = Guest
        fields = [
            'id', 'event', 'name', 'email', 'normalized_email',
            'revision', 'rsvp_responded_at', 'is_checked_in',
            'email_status', 'last_email_sent_at', 'email_log_id',
            'phone', 'rsvp_status', 'ticket_type', 'ticket_id',
            'qr_code', 'plus_ones', 'dietary_restrictions',
            'custom_fields', 'user_id', 'cost_share_enabled',
            'cost_share_amount', 'payment_status', 'payment_intent_id',
            'checked_in', 'checked_in_at', 'role', 'metadata',
            'created_at', 'updated_at',
        ]


class PartyBoardStickySerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = [
            'id', 'event', 'session_id', 'type', 'position_x',
            'position_y', 'width', 'height', 'rotation',
            'z_index', 'category', 'data', 'creator',
            'created_at', 'updated_at',
        ]


class PartyBoardStickyVoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = ['id', 'sticky', 'user', 'created_at']


class PartyBoardTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = [
            'id', 'event', 'sticky', 'title', 'description',
            'assignee', 'completed', 'due_date',
            'created_at', 'updated_at',
        ]


class PollSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = ['id', 'question', 'options', 'votes', 'status', 'created_at']


class TimelineBlockSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = ['id', 'event', 'block_type', 'content', 'order', 'created_at']