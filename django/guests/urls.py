from django.urls import path
from .views import IndexGuestsView, CreateGuestView, UpdateGuestView, UpdateRSVPView, CheckInGuestView

urlpatterns = [
    path('', IndexGuestsView.as_view(), name='index'),
    path('create/', CreateGuestView.as_view(), name='create'),
    path('<uuid:guest_id>/', UpdateGuestView.as_view(), name='update'),
    path('<uuid:guest_id>/rsvp/', UpdateRSVPView.as_view(), name='rsvp'),
    path('<uuid:guest_id>/check-in/', CheckInGuestView.as_view(), name='check_in'),
]
