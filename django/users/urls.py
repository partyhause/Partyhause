app_name = 'users'

from django.urls import path
from . import views

urlpatterns = [
    path('me/', views.MeView.as_view(), name='me'),
    path('me/profile/', views.ProfileView.as_view(), name='profile'),
    path('me/onboarding/', views.OnboardingView.as_view(), name='onboarding'),
    path('me/username', views.UsernameView.as_view(), name='username'),
    path('suggested', views.SuggestedUsersView.as_view(), name='suggested'),
    path('<str:user_id>/', views.UserView.as_view(), name='user_detail'),
]
