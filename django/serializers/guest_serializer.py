from rest_framework import serializers
from guests.models import Guest
from accounts.models import User

class GuestSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    
    class Meta:
        model = Guest
        fields = [
            'id', 'event', 'user', 'name', 'email', 'normalized_email',
            'phone', 'rsvp_status', 'rsvp_responded_at', 'dietary_restrictions',
            'custom_fields', 'checked_in', 'checked_in_at', 'is_checked_in',
            'role', 'metadata', 'email_status', 'last_email_sent_at',
            'cost_share_enabled', 'cost_share_amount', 'payment_status',
            'payment_intent_id', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
