from django.db import models
import uuid
from django.conf import settings
from django.utils import timezone

class TimelineBlock(models.Model):
    BLOCK_TYPES = [
        ('welcome', 'Welcome'),
        ('activity', 'Activity'),
        ('break', 'Break'),
        ('meal', 'Meal'),
        ('speech', 'Speech'),
        ('entertainment', 'Entertainment'),
        ('closing', 'Closing'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='timeline_blocks')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    block_type = models.CharField(max_length=20, choices=BLOCK_TYPES, default='activity')
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    location = models.CharField(max_length=255, blank=True, null=True)
    responsible_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='timeline_blocks')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'timeline_blocks'
        ordering = ['start_time']
    
    def __str__(self):
        return f"{self.title} - {self.event.name}"
    
    def clean(self):
        if self.start_time >= self.end_time:
            raise ValueError("End time must be after start time")
        if self.event and self.start_time < self.event.start_date:
            raise ValueError("Timeline block cannot start before event start")
        if self.event and self.end_time > self.event.end_date:
            raise ValueError("Timeline block cannot end after event end")
    
    @property
    def duration_minutes(self):
        delta = self.end_time - self.start_time
        return int(delta.total_seconds() / 60)
    
    @property
    def is_overlapping(self):
        overlapping = TimelineBlock.objects.filter(
            event=self.event,
            start_time__lt=self.end_time,
            end_time__gt=self.start_time
        ).exclude(pk=self.pk)
        return overlapping.exists()

class EventTimelineManager:
    def __init__(self, event):
        self.event = event
    
    def add_block(self, title, start_time, end_time, block_type='activity', **kwargs):
        block = TimelineBlock(
            event=self.event,
            title=title,
            start_time=start_time,
            end_time=end_time,
            block_type=block_type,
            **kwargs
        )
        block.clean()
        if block.is_overlapping:
            raise ValueError("Timeline block overlaps with existing block")
        block.save()
        return block
    
    def get_schedule(self):
        return TimelineBlock.objects.filter(event=self.event).order_by('start_time')
    
    def get_free_slots(self, duration_minutes=60):
        slots = []
        current = self.event.start_date
        end = self.event.end_date
        
        blocks = self.get_schedule()
        for block in blocks:
            if current < block.start_time:
                gap_minutes = int((block.start_time - current).total_seconds() / 60)
                if gap_minutes >= duration_minutes:
                    slots.append({'start': current, 'end': block.start_time})
            current = max(current, block.end_time)
        
        if current < end:
            gap_minutes = int((end - current).total_seconds() / 60)
            if gap_minutes >= duration_minutes:
                slots.append({'start': current, 'end': end})
        
        return slots
