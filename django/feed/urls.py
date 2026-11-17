from django.urls import path
from . import views

urlpatterns = [
    path('crew/', views.CrewFeedView.as_view(), name='crew'),
    path('seen/', views.SeenView.as_view(), name='seen'),
]
