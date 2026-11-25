from django.urls import path
from . import views

urlpatterns = [
    path('', views.AccountView.as_view(), name='account'),
    path('deletion-intent/', views.DeletionIntentView.as_view(), name='deletion_intent'),
    path('deletion/', views.DeletionView.as_view(), name='deletion'),
]
