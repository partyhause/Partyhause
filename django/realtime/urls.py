from django.urls import path
from . import views

urlpatterns = [
    path('negotiate/', views.NegotiateView.as_view(), name='negotiate'),
]
