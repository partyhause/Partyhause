from django.urls import path
from . import views

urlpatterns = [
    path('', views.EmailLogListView.as_view(), name='list'),
    path('<str:log_id>/', views.EmailLogDetailView.as_view(), name='detail'),
]
