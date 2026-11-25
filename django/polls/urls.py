from django.urls import path
from . import views

urlpatterns = [
    path('', views.PollListView.as_view(), name='list'),
    path('<str:poll_id>/', views.PollDetailView.as_view(), name='detail'),
    path('<str:poll_id>/vote/', views.PollVoteView.as_view(), name='vote'),
    path('<str:poll_id>/close/', views.PollCloseView.as_view(), name='close'),
]
