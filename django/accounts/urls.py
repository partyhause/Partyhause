from django.urls import path
from . import views

urlpatterns = [
    path('signup/', views.SignupView.as_view(), name='signup'),
    path('verify-email/', views.VerifyEmailView.as_view(), name='verify_email'),
    path('resend-verification/', views.ResendVerificationView.as_view(), name='resend_verification'),
    path('login/', views.LoginView.as_view(), name='login'),
    path('me/', views.MeView.as_view(), name='me'),
    path('me/role/', views.RoleUpdateView.as_view(), name='role_update'),
    path('forgot-password/', views.ForgotPasswordView.as_view(), name='forgot_password'),
    path('reset-password/', views.ResetPasswordView.as_view(), name='reset_password'),
    path('logout/', views.LogoutView.as_view(), name='logout'),
    path('rsvp/resolve/<str:invitation_token>/', views.ResolveRSVPView.as_view(), name='rsvp_resolve'),
    path('rsvp/', views.SubmitRSVPView.as_view(), name='rsvp_submit'),
]
