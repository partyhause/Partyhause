from rest_framework import serializers
from events.models import Event
from accounts.models import User

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'name']

class EventSerializer(serializers.ModelSerializer):
    host = UserSerializer(read_only=True)
    guest_count = serializers.ReadOnlyField()
    is_active = serializers.ReadOnlyField()
    
    class Meta:
        model = Event
        fields = [
            'id', 'host', 'name', 'start_date', 'end_date', 'event_type',
            'location', 'description', 'invite_image_url', 'max_guests',
            'is_public', 'privacy', 'status', 'settings', 'timeline_blocks',
            'revision', 'published_at', 'cancelled_at', 'completed_at',
            'created_at', 'updated_at', 'guest_count', 'is_active'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'revision']
