from django.urls import path

from . import views

urlpatterns = [
    path('', views.IndexTasksView.as_view(), name='tasks'),
]
