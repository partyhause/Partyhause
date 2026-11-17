from django.urls import path
from . import views

urlpatterns = [
    path('', views.EventTemplateListView.as_view(), name='list'),
    path('<str:template_id>/', views.EventTemplateDetailView.as_view(), name='detail'),
    path('<str:template_id>/use/', views.EventTemplateUseView.as_view(), name='use'),
    path('<str:template_id>/create-event/', views.EventTemplateCreateEventView.as_view(), name='create_event'),
]
