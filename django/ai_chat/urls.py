from django.urls import path
from . import views_async

urlpatterns = [
    path('chat/', views_async.ChatStreamView.as_view(), name='chat'),
]
