from django.urls import path

from . import views

urlpatterns = [
    path('chat/', views.ChatView.as_view(), name='chat'),
    path('board-action/', views.BoardActionView.as_view(), name='board_action'),
]