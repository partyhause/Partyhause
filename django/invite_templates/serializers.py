from rest_framework import serializers
from .models import InviteTemplate


class InviteTemplateSerializer(serializers.ModelSerializer):
    author_email = serializers.EmailField(source='author.email', read_only=True)

    class Meta:
        model = InviteTemplate
        fields = [
            'id',
            'name',
            'category',
            'default_payload',
            'usage_count',
            'last_used_at',
            'is_public',
            'author_email',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'author', 'author_email', 'created_at', 'updated_at']
