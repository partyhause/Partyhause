from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/events/', include('events.urls')),
    path('api/guests/', include('guests.urls')),
    # PartyBoard routes
    path('api/partyboard/stickies/', include('partyboard.urls')),
    path('api/partyboard/tasks/', include('partyboard.urls')),
    # Users
    path('api/users/', include('users.urls')),
    # Notifications
    path('api/notifications/', include('notifications.urls')),
    # Event templates
    path('api/event-templates/', include('event_templates.urls')),
    # Invite templates
    path('api/invite-templates/', include('invite_templates.urls')),
    # Feed
    path('api/feed/', include('feed.urls')),
    # Partycrew
    path('api/partycrew/', include('partycrew.urls')),
    # Polls
    path('api/polls/', include('polls.urls')),
    # Email logs
    path('api/email-logs/', include('email_logs.urls')),
    # Transactional email send (invites, guest correspondence)
    path('api/send-email/', include('sendemail.urls')),
    # External event ingestion
    path('api/external-events/', include('external_events.urls')),
    # Storage
    path('api/realtime/', include('realtime.urls')),
    # MVP account
    path('api/mvp/account/', include('account.urls')),
    # Billing
    path('api/billing/', include('billing.urls')),
    # Onboarding
    path('api/onboarding/', include('onboarding.urls')),
    # Cost split
    path('api/cost-split/', include('cost_split.urls')),
    # RSVP
    path('api/rsvp/', include('rsvp.urls')),
    # Health
    path('api/partyplates/', include('partyplates.urls')),
    path('api/health/', include('health.urls')),
    path('api/ai/', include('ai_chat.urls')),
]
