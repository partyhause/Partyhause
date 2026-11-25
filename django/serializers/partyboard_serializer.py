from rest_framework import serializers
from partyboard.models import PartyBoardSticky, PartyBoardStickyVote
from accounts.models import User

class PartyBoardStickySerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    vote_count = serializers.ReadOnlyField()
    
    class Meta:
        model = PartyBoardSticky
        fields = [
            'id', 'event', 'session_id', 'type', 'position_x', 'position_y',
            'width', 'height', 'rotation', 'z_index', 'category', 'data',
            'created_by', 'created_at', 'updated_at', 'vote_count'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
