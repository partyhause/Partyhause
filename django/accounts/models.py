from django.db import models
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager
from django.utils import timezone
from django.contrib.auth.hashers import make_password

from partyhause.model_utils import uuid_str

class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('Email required')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        return self.create_user(email, password, **extra_fields)

class User(AbstractBaseUser, PermissionsMixin):
    id = models.TextField(primary_key=True, default=uuid_str, editable=False)
    password = models.CharField(max_length=128)
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=255, blank=True, null=True)
    email_verified = models.BooleanField(default=False)
    verification_token = models.CharField(max_length=255, unique=True, blank=True, null=True)
    verification_token_expires = models.DateTimeField(blank=True, null=True)
    reset_token = models.CharField(max_length=255, unique=True, blank=True, null=True)
    reset_token_expires = models.DateTimeField(blank=True, null=True)
    token_version = models.IntegerField(default=0)
    account_status = models.CharField(max_length=50, default='active')
    terms_version = models.CharField(max_length=100, blank=True, null=True)
    privacy_version = models.CharField(max_length=100, blank=True, null=True)
    age_eligible = models.BooleanField(default=False)
    deletion_requested_at = models.DateTimeField(blank=True, null=True)
    stripe_customer_id = models.CharField(max_length=255, unique=True, blank=True, null=True)
    account_role = models.CharField(max_length=50, blank=True, null=True)
    card_verified_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    groups = models.ManyToManyField('auth.Group', related_name='partyhause_users', blank=True)
    user_permissions = models.ManyToManyField('auth.Permission', related_name='partyhause_users', blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []
    objects = UserManager()

    class Meta:
        db_table = 'users'

    def __str__(self):
        return self.email
