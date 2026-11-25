from django.urls import path
from . import views

urlpatterns = [
    path('', views.InviteTemplateListView.as_view(), name='list'),
    path('<str:template_id>/', views.InviteTemplateDetailView.as_view(), name='detail'),
]
