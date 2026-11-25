from django.urls import path
from . import views

urlpatterns = [
    path('trial/start/', views.TrialStartView.as_view(), name='trial_start'),
]
