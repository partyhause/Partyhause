from django.urls import path
from .views import IndexEventsView, CreateEventView, GetEventView, UpdateEventView, PublishEventView, TimelineCreateView

urlpatterns = [
    path('', IndexEventsView.as_view(), name='index'),
    path('create/', CreateEventView.as_view(), name='create'),
    path('<uuid:event_id>/', GetEventView.as_view(), name='get'),
    path('<uuid:event_id>/update/', UpdateEventView.as_view(), name='update'),
    path('<uuid:event_id>/publish/', PublishEventView.as_view(), name='publish'),
    path('<uuid:event_id>/timeline/', TimelineCreateView.as_view(), name='timeline_create'),

]