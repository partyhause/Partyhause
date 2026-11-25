from rest_framework import serializers
from .models import EventTemplate


class EventTemplateSerializer(serializers.ModelSerializer):
    author_email = serializers.EmailField(source='author.email', read_only=True)

    class Meta:
        model = EventTemplate
        fields = [
            'id',
            'name',
            'slug',
            'description',
            'category',
            'hero_image_url',
            'price_tier',
            'default_payload',
            'required_fields_schema',
            'featured',
            'published',
            'usage_count',
            'author_email',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'author', 'author_email', 'created_at', 'updated_at']
