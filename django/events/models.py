from django.db import models
from django.conf import settings as django_settings
from django.utils import timezone

from partyhause.model_utils import uuid_str

class Event(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    host = models.ForeignKey(django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='hosted_events', db_column='host_id')
    name = models.CharField(max_length=255)
    title = models.CharField(max_length=255, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    start_date = models.DateTimeField()
    end_date = models.DateTimeField()
    event_date = models.DateTimeField(blank=True, null=True)
    event_type = models.CharField(max_length=50, default='single_day')
    location = models.CharField(max_length=255, blank=True, null=True)
    location_name = models.CharField(max_length=255, blank=True, null=True)
    location_address = models.TextField(blank=True, null=True)
    location_coordinates = models.JSONField(blank=True, null=True)
    timezone = models.CharField(max_length=50, default='UTC')
    privacy = models.CharField(max_length=20, default='private')
    status = models.CharField(max_length=20, default='draft')
    max_guests = models.IntegerField(default=50)
    is_public = models.BooleanField(default=False)
    invite_image_url = models.URLField(blank=True, null=True)
    spotify_playlist_url = models.URLField(blank=True, null=True)
    template_type = models.CharField(max_length=100, blank=True, null=True)
    settings = models.JSONField(default=dict)
    template_data = models.JSONField(default=dict)
    timeline_blocks = models.JSONField(default=list)
    revision = models.IntegerField(default=1)
    published_at = models.DateTimeField(blank=True, null=True)
    cancelled_at = models.DateTimeField(blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    external_event_id = models.CharField(max_length=255, blank=True, null=True)
    external_source = models.CharField(max_length=100, blank=True, null=True)
    external_metadata = models.JSONField(blank=True, null=True)
    # The user who imported this external event (null for natively created events).
    imported_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='imported_events',
        db_column='imported_by_id',
        null=True,
        blank=True,
    )
    place_id = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'events'
        indexes = [
            models.Index(fields=['host']),
            models.Index(fields=['status']),
            models.Index(fields=['start_date', 'end_date']),
            models.Index(fields=['imported_by']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['imported_by', 'external_source', 'external_event_id'],
                name='unique_external_event_per_user',
                condition=models.Q(imported_by__isnull=False),
            )
        ]
    def publish(self):
        if not self.name or not self.start_date or not self.location:
            raise ValueError("Event name, start date, and location are required for publishing")
        if self.start_date <= timezone.now():
            raise ValueError("Cannot publish event with past start date")
        self.status = 'published'
        self.published_at = timezone.now()
        self.save()
        return self

    def can_publish(self):
        return bool(self.name and self.start_date and self.location and self.start_date > timezone.now())

    def cancel(self, reason=None):
        if self.status == 'cancelled':
            return False
        self.status = 'cancelled'
        self.cancelled_at = timezone.now()
        self.save()
        return True

    def check_capacity(self):
        from guests.models import Guest
        accepted_guests = Guest.objects.filter(event=self, rsvp_status__in=['accepted', 'confirmed']).count()
        return accepted_guests < self.max_guests

    def get_rsvp_stats(self):
        from guests.models import Guest
        guests = Guest.objects.filter(event=self)
        return {
            'total': guests.count(),
            'accepted': guests.filter(rsvp_status__in=['accepted', 'confirmed']).count(),
            'declined': guests.filter(rsvp_status='declined').count(),
            'maybe': guests.filter(rsvp_status='maybe').count(),
            'pending': guests.filter(rsvp_status='pending').count(),
            'checked_in': guests.filter(checked_in=True).count()
        }

class EventCoHost(models.Model):
    id = models.CharField(primary_key=True, default=uuid_str, editable=False, max_length=64)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='co_hosts', db_column='event_id')
    user = models.ForeignKey(django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='co_hosted_events', db_column='user_id')
    role = models.CharField(max_length=50, default='co-host')
    permissions = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'event_co_hosts'
        unique_together = [['event', 'user']]
        indexes = [
            models.Index(fields=['event']),
            models.Index(fields=['user']),
        ]
