from django.urls import path
from . import views

urlpatterns = [
    path('', views.SendEmailView.as_view(), name='send_email'),
]
