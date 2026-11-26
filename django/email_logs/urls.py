from django.urls import path

from . import views

urlpatterns = [
    path('', views.EmailLogListView.as_view(), name='list'),
    # This literal path must stay above the UUID route. Express bound
    # `id="analytics"` while this sat after `/:id`, so the endpoint was
    # unreachable for its entire life.
    path('analytics/event/', views.EmailAnalyticsView.as_view(), name='analytics'),
    path('<uuid:log_id>/', views.EmailLogDetailView.as_view(), name='detail'),
]
