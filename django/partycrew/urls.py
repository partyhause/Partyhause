from django.urls import path

from . import views

urlpatterns = [
    path('members/', views.MembersView.as_view(), name='members'),
    path('crewing-with/', views.CrewingWithView.as_view(), name='crewing_with'),
    path('toggle/', views.ToggleView.as_view(), name='toggle'),
    path('requests/', views.RequestsView.as_view(), name='requests'),
]
