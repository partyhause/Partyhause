from django.urls import path
from . import views

urlpatterns = [
    path('resolve/', views.RsvpResolveView.as_view(), name='rsvp_resolve'),
    path('', views.RsvpView.as_view(), name='rsvp'),
]
