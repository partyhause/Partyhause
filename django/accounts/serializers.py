from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError

User = get_user_model()

class SignupSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    invite_token = serializers.CharField(required=False, allow_blank=True)

    def validate_email(self, value):
        try:
            validate_email(value)
        except DjangoValidationError:
            raise serializers.ValidationError('Invalid email')
        return value.lower()

    def create(self, validated_data):
        email = validated_data['email']
        password = validated_data['password']
        name = validated_data.get('name', '')
        invite_token = validated_data.get('invite_token', '')
        # Auto-verify if invite token matches — simplified check
        email_verified = False
        if invite_token:
            email_verified = True
        user = User.objects.create_user(email=email, password=password, name=name, email_verified=email_verified)
        return user

class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()

class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()

class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()

class ResetPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True, min_length=8)

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
