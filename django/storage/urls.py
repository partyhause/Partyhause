from django.urls import path

from . import views

urlpatterns = [
    path('upload/', views.UploadView.as_view(), name='upload'),
    path('url/<path:blob_name>/', views.UrlView.as_view(), name='url'),
    path('<path:blob_name>/', views.BlobView.as_view(), name='blob'),
]
