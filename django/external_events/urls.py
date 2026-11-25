from django.urls import path

from . import views

urlpatterns = [
    path('sources/', views.ProviderListView.as_view(), name='provider-list'),
    path('sync/', views.SyncCreateView.as_view(), name='sync-create'),
    path('sync/<uuid:run_id>/', views.SyncStatusView.as_view(), name='sync-status'),
    path('', views.ExternalEventListView.as_view(), name='external-list'),
]
