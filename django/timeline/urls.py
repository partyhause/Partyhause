from django.urls import path

from . import views

urlpatterns = [
    path('', views.TimelineCreateView.as_view(), name='timeline_create'),
    path('<uuid:item_id>/', views.TimelineEventView.as_view(), name='timeline_event'),
]
