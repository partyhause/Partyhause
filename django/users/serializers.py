from rest_framework import serializers
from django.contrib.auth import get_user_model
from users.models import UserProfile

User = get_user_model()


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = [
            'id',
            'account_type',
            'bio',
            'avatar_url',
            'location',
            'website_url',
            'phone',
            'is_private',
            'haus_score',
            'partycrew_count',
            'crewing_count',
            'events_hosted',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'haus_score',
            'partycrew_count',
            'crewing_count',
            'events_hosted',
            'created_at',
            'updated_at',
        ]


class ProfileSerializer(serializers.ModelSerializer):
    """Authenticated user's own profile: core User fields plus nested UserProfile."""

    profile = UserProfileSerializer(read_only=True)
    username = serializers.CharField(source='name', required=False, allow_blank=True, allow_null=True)
    display_name = serializers.CharField(source='name', required=False, allow_blank=True, allow_null=True)
    cover_photo_url = serializers.URLField(required=False, allow_blank=True, allow_null=True)
    is_verified = serializers.BooleanField(source='email_verified', read_only=True)
    last_active_at = serializers.DateTimeField(source='updated_at', read_only=True)
    account_type = serializers.CharField(source='profile.account_type', required=False, allow_blank=True, allow_null=True)
    bio = serializers.CharField(source='profile.bio', required=False, allow_blank=True, allow_null=True)
    avatar_url = serializers.URLField(source='profile.avatar_url', required=False, allow_blank=True, allow_null=True)
    location = serializers.CharField(source='profile.location', required=False, allow_blank=True, allow_null=True)
    website_url = serializers.URLField(source='profile.website_url', required=False, allow_blank=True, allow_null=True)
    phone = serializers.CharField(source='profile.phone', required=False, allow_blank=True, allow_null=True)
    is_private = serializers.BooleanField(source='profile.is_private', required=False)

    class Meta:
        model = User
        fields = [
            'id',
            'email',
            'name',
            'email_verified',
            'account_role',
            'created_at',
            'profile',
            'username',
            'display_name',
            'cover_photo_url',
            'is_verified',
            'last_active_at',
            'account_type',
            'bio',
            'avatar_url',
            'location',
            'website_url',
            'phone',
            'is_private',
        ]
        read_only_fields = ['id', 'email', 'email_verified', 'account_role', 'created_at', 'profile', 'username', 'display_name', 'cover_photo_url', 'is_verified', 'last_active_at', 'bio', 'avatar_url', 'location', 'website_url', 'phone', 'is_private']

    def update(self, instance, validated_data):
        profile_data = validated_data.pop('profile', {}) or {}

        # Updatable core User field.
        if 'name' in validated_data:
            instance.name = validated_data['name'] or instance.name
            instance.save(update_fields=['name', 'updated_at'])

        # Ensure a UserProfile exists, then apply writable profile fields.
        profile, _ = UserProfile.objects.get_or_create(user=instance)
        writable = [
            'account_type', 'bio', 'avatar_url', 'location',
            'website_url', 'phone', 'is_private',
        ]
        changed = []
        for field in writable:
            if field in profile_data:
                value = profile_data[field]
                setattr(profile, field, value if value not in (None, '') else None)
                changed.append(field)
        if changed:
            changed.append('updated_at')
            profile.save(update_fields=changed)

        return instance
