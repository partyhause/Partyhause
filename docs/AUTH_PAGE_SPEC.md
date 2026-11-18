# Auth Page Spec

Path: `/auth`
Component: `AuthScreen`
Auth: None

Modes: `auth`, `signup`, `forgot-password`, `reset-password`

Signup returns NO token until email verified, unless invite token present → auto-verify.
Login 403 EMAIL_NOT_VERIFIED → offer resend verification.
Resend verification is anonymous by design.

Storage on success:
- setStoredToken(token)
- setStoredUser(user)

After success: navigate to `/dashboard` or onboarding gate.
