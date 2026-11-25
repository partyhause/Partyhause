from django.urls import path
from . import views

urlpatterns = [
    path('<str:event_id>/', views.TimelineListView.as_view(), name='timeline_list'),
    path('', views.TimelineCreateView.as_view(), name='timeline_create'),
    path('<str:id>/', views.TimelineUpdateView.as_view(), name='timeline_update'),
    path('<str:id>/', views.TimelineDeleteView.as_view(), name='timeline_delete'),
]
