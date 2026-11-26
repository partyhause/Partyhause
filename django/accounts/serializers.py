import hashlib

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.utils import timezone
from rest_framework import serializers

User = get_user_model()


def _first(data, *keys):
    for key in keys:
        value = data.get(key)
        if value not in (None, ''):
            return value
    return None


def find_valid_invitation(raw_token, email):
    """Return the GuestInvitation that proves ownership of `email`, or None.

    Invitation tokens are mailed to the guest's address and stored as a
    SHA-256 digest, so the raw value from the URL is hashed before lookup.
    Every failure returns None: a malformed or unmatched token must never
    block a signup, it only declines to auto-verify the address.
    """
    if not raw_token or not isinstance(raw_token, str):
        return None
    from rsvp.models import GuestInvitation

    digest = hashlib.sha256(raw_token.encode()).hexdigest()
    invitation = (
        GuestInvitation.objects.select_related('guest', 'event')
        .filter(
            token=digest,
            revoked=False,
            expires_at__gt=timezone.now(),
        )
        .first()
    )
    if invitation is None:
        return None
    guest_email = (invitation.guest.normalized_email or invitation.guest.email or '').strip().lower()
    if guest_email != email:
        return None
    return invitation


class SignupSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)

    # The web and mobile clients send camelCase; the older API contract used
    # snake_case. Both are accepted, and `validate` normalises them.
    invite_token = serializers.CharField(required=False, allow_blank=True, write_only=True)
    inviteToken = serializers.CharField(required=False, allow_blank=True, write_only=True)
    age_eligible = serializers.BooleanField(required=False)
    ageEligible = serializers.BooleanField(required=False)
    terms_version = serializers.CharField(required=False, allow_blank=True, max_length=100)
    termsVersion = serializers.CharField(required=False, allow_blank=True, max_length=100)
    privacy_version = serializers.CharField(required=False, allow_blank=True, max_length=100)
    privacyVersion = serializers.CharField(required=False, allow_blank=True, max_length=100)

    def validate_email(self, value):
        value = (value or '').strip().lower()
        try:
            validate_email(value)
        except DjangoValidationError:
            raise serializers.ValidationError('Invalid email')
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists')
        return value

    def validate(self, attrs):
        attrs['invite_token'] = (
            attrs.get('invite_token') or attrs.get('inviteToken') or ''
        ).strip()
        attrs['age_eligible'] = _first(attrs, 'age_eligible', 'ageEligible')
        attrs['terms_version'] = (_first(attrs, 'terms_version', 'termsVersion') or '').strip()
        attrs['privacy_version'] = (_first(attrs, 'privacy_version', 'privacyVersion') or '').strip()

        if attrs['age_eligible'] is False:
            raise serializers.ValidationError(
                {'ageEligible': 'You must confirm that you meet the minimum age.'}
            )
        if getattr(settings, 'REQUIRE_SIGNUP_CONSENT', False):
            if attrs['age_eligible'] is not True:
                raise serializers.ValidationError(
                    {'ageEligible': 'You must confirm that you meet the minimum age.'}
                )
            if not attrs['terms_version'] or not attrs['privacy_version']:
                raise serializers.ValidationError(
                    {'consent': 'Terms and privacy acceptance are required.'}
                )

        candidate = User(email=attrs['email'], name=attrs.get('name') or '')
        try:
            validate_password(attrs['password'], candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': list(exc.messages)})
        return attrs

    def create(self, validated_data):
        email = validated_data['email']
        password = validated_data['password']
        name = validated_data.get('name') or ''
        invitation = find_valid_invitation(validated_data.get('invite_token'), email)

        user = User.objects.create_user(
            email=email,
            password=password,
            name=name,
            email_verified=invitation is not None,
            terms_version=validated_data.get('terms_version') or None,
            privacy_version=validated_data.get('privacy_version') or None,
            age_eligible=bool(validated_data.get('age_eligible')),
        )

        if invitation is not None:
            guest = invitation.guest
            if guest.user_id is None:
                guest.user_id = user.id
                guest.save(update_fields=['user_id'])
            invitation.revoked = True
            invitation.save(update_fields=['revoked'])
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate_email(self, value):
        return (value or '').strip().lower()


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        return (value or '').strip().lower()


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        return (value or '').strip().lower()


class ResetPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_email(self, value):
        return (value or '').strip().lower()

    def validate(self, attrs):
        candidate = User(email=attrs['email'])
        try:
            validate_password(attrs['password'], candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': list(exc.messages)})
        return attrs


class MeSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'name', 'email_verified', 'account_role', 'created_at']
        read_only_fields = ['id', 'email', 'name', 'email_verified', 'created_at']


class RoleUpdateSerializer(serializers.Serializer):
    account_role = serializers.ChoiceField(choices=['user', 'creator', 'vendor'])

    def update(self, instance, validated_data):
        instance.account_role = validated_data['account_role']
        instance.save(update_fields=['account_role', 'updated_at'])
        return instance
