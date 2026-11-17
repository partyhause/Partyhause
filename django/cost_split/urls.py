from django.urls import path
from . import views

urlpatterns = [
    path('', views.CostSplitListView.as_view(), name='list'),
    path('<str:split_id>/', views.CostSplitDetailView.as_view(), name='detail'),
]
