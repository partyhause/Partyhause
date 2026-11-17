from django.urls import path
from . import views

urlpatterns = [
    path('upload/', views.UploadView.as_view(), name='upload'),
    path('<str:blob_name>/', views.BlobView.as_view(), name='blob'),
    path('url/<str:blob_name>/', views.UrlView.as_view(), name='url'),
]
