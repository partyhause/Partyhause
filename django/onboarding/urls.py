from django.urls import path
from . import views

urlpatterns = [
    path('', views.OnboardingView.as_view(), name='onboarding'),
]
