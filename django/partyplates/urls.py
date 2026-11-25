from django.urls import path
from . import views

urlpatterns = [
    path('', views.PartyPlateListView.as_view(), name='list'),
    path('create/', views.PartyPlateCreateView.as_view(), name='create'),
]
