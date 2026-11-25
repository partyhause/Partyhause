from rest_framework import serializers
from polls.models import Poll, PollOption, PollVote
from accounts.models import User

class PollOptionSerializer(serializers.ModelSerializer):
    vote_count = serializers.ReadOnlyField()
    
    class Meta:
        model = PollOption
        fields = ['id', 'text', 'description', 'created_at', 'vote_count']
        read_only_fields = ['id', 'created_at']

class PollSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    options = PollOptionSerializer(many=True, read_only=True)
    is_active = serializers.ReadOnlyField()
    
    class Meta:
        model = Poll
        fields = [
            'id', 'event', 'created_by', 'question', 'poll_type', 'ends_at',
            'auto_close_on_consensus', 'consensus_threshold', 'status',
            'created_at', 'closed_at', 'options', 'is_active'
        ]
        read_only_fields = ['id', 'created_at', 'closed_at']
