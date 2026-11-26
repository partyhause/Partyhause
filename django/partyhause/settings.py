"""
Django settings for partyhause project.

Secrets are read from the environment. The committed development value is
refused in production so a deploy cannot silently run with a key that is in
the repository: anyone holding the source could otherwise mint a JWT for any
account. See `docs/` and `AGENTS.md` for the Key Vault provisioning path.
"""
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

DJANGO_ENV = (os.environ.get('DJANGO_ENV') or 'development').strip().lower()
IS_PRODUCTION = DJANGO_ENV == 'production'


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')


DEBUG = _env_bool('DJANGO_DEBUG', not IS_PRODUCTION)

# A new signup must assert the age gate and the current terms/privacy versions
# in production. Kept configurable so a local fixture or a migration script
# can create an account without legal copy.
REQUIRE_SIGNUP_CONSENT = _env_bool('REQUIRE_SIGNUP_CONSENT', IS_PRODUCTION)

# Django's own signing key (sessions, password-reset tokens, messages) and the
# JWT signing key are separate on purpose: rotating one must not invalidate the
# other. `DJANGO_SECRET_KEY` overrides; when it is absent the existing
# production `JWT_SECRET` is reused so a deploy does not crash-loop merely
# because the newer variable has not been provisioned yet.
_DEV_SECRET = 'dev-only-insecure-change-me-partyhause'
JWT_SECRET = (os.environ.get('JWT_SECRET') or '').strip()
SECRET_KEY = (os.environ.get('DJANGO_SECRET_KEY') or '').strip() or JWT_SECRET

if IS_PRODUCTION:
    if not JWT_SECRET:
        raise ImproperlyConfigured('JWT_SECRET must be set in production')
    if len(JWT_SECRET) < 32:
        raise ImproperlyConfigured('JWT_SECRET must be at least 32 characters in production')
    if not SECRET_KEY:
        raise ImproperlyConfigured(
            'DJANGO_SECRET_KEY (or JWT_SECRET) must be set in production'
        )
    if SECRET_KEY.startswith('django-insecure-') or SECRET_KEY == _DEV_SECRET:
        raise ImproperlyConfigured(
            'Refusing the committed development SECRET_KEY in production'
        )
else:
    SECRET_KEY = SECRET_KEY or _DEV_SECRET
    JWT_SECRET = JWT_SECRET or SECRET_KEY

APPEND_SLASH = True  # Django default; the shared client appends the slash
PREPEND_WWW = False
AUTH_USER_MODEL = 'accounts.User'
LOGIN_URL = '/accounts/login/'
LOGIN_REDIRECT_URL = '/dashboard/'

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'channels',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'accounts',
    'events',
    'guests',
    'partyboard',
    'polls',
    'users',
    'notifications',
    'invite_templates',
    'feed',
    'partycrew',
    'email_logs',
    'storage',
    'timeline',
    'realtime',
    'account',
    'billing',
    'onboarding',
    'event_templates',
    'cost_split',
    'rsvp',
    'ai_chat',
    'external_events',
    'health',
]

MIDDLEWARE = [
    'partyhause.middleware.CsrfExemptMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    # Must run before CommonMiddleware: APPEND_SLASH answers a slash-less POST
    # with a 301, which browsers follow as a GET and drop the body.
    'partyhause.middleware.SlashTolerantMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'partyhause.middleware.JWTAuthenticationMiddleware',
    'partyhause.middleware.AuthBypassMiddleware',
]

ROOT_URLCONF = 'partyhause.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'partyhause.wsgi.application'
ASGI_APPLICATION = 'partyhause.asgi.application'

_allowed = os.environ.get('ALLOWED_HOSTS', '')
_fallback = ['localhost', '127.0.0.1', 'partyhause-django', 'ca-app-partyhause-combined.salmonsand-b1c1ecc2.eastus2.azurecontainerapps.io', 'partyhause.uk', 'www.partyhause.uk']
ALLOWED_HOSTS = [h.strip() for h in _allowed.split(',') if h.strip()] or _fallback
from urllib.parse import urlparse
_database_url = os.environ.get('DATABASE_URL', 'postgresql://partyhause:partyhause@db:5432/partyhause')
_parsed = urlparse(_database_url)
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': _parsed.path[1:] or 'partyhause',
        'USER': _parsed.username or 'partyhause',
        'PASSWORD': _parsed.password or 'partyhause',
        'HOST': _parsed.hostname or 'localhost',
        'PORT': str(_parsed.port or 5432),
        'OPTIONS': ({'sslmode': 'require'} if _parsed.hostname and _parsed.hostname not in ('localhost', '127.0.0.1', 'partyhause-db') else {}),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',},
]


LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

# Channels is used for the optional websocket layer. Redis is only required
# when it is actually configured; defaulting to an in-memory layer keeps a
# fresh checkout and a single-replica deployment from logging a connection
# error on every request.
_redis_url = (os.environ.get('REDIS_URL') or '').strip()
if _redis_url:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [_redis_url]},
        },
    }
else:
    CHANNEL_LAYERS = {
        'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
    }


def _csv_env(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name)
    if not raw:
        return default
    return [item.strip().rstrip('/') for item in raw.split(',') if item.strip()]


_default_origins = [
    'http://localhost:5173',
    'https://partyhause.uk',
    'https://www.partyhause.uk',
]
CORS_ALLOWED_ORIGINS = _csv_env('CORS_ALLOWED_ORIGINS', _default_origins)
CORS_ALLOW_CREDENTIALS = True
SESSION_ENGINE = 'django.contrib.sessions.backends.db'
SESSION_COOKIE_NAME = 'partyhause_session'
SESSION_COOKIE_AGE = 604800  # 7 days, matches JWT lifetime
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = _env_bool('SESSION_COOKIE_SECURE', IS_PRODUCTION)
SESSION_COOKIE_SAMESITE = 'lax'
SESSION_COOKIE_DOMAIN = None
SESSION_SAVE_EVERY_REQUEST = False

CSRF_TRUSTED_ORIGINS = _csv_env('CSRF_TRUSTED_ORIGINS', _default_origins)
CSRF_COOKIE_SECURE = _env_bool('CSRF_COOKIE_SECURE', IS_PRODUCTION)
CSRF_COOKIE_SAMESITE = 'lax'
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
# Azure Container Apps terminates TLS at the ingress; redirecting inside the
# container would loop unless the forwarded-proto header is trusted, so the
# ingress owns the HTTP→HTTPS redirect.
SECURE_SSL_REDIRECT = False
USE_X_FORWARDED_HOST = True
USE_X_FORWARDED_PORT = True
if IS_PRODUCTION:
    SECURE_HSTS_SECONDS = int(os.environ.get('SECURE_HSTS_SECONDS', '31536000'))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = False
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
    'idempotency-key',
]

# Email transport: Azure Communication Services (primary) with Resend fallback.
#
# EMAIL_BACKEND selects the Django backend. Use the ACS-backed backend in any
# environment where real delivery is desired; fall back to the SMTP backend
# (Mailpit) only when ACS_CONNECTION_STRING is unset, so local dev still works
# without credentials.
#
# ACS requires a verified sender address. ACS_SENDER_ADDRESS must be a
# sender bound to a DNS-verified domain in the Communication Service (e.g.
# noreply@partyhause.uk). Until that domain is verified, mail still flows via
# the Resend fallback using RESEND_FROM_EMAIL.
#
# Env vars (all optional; unset => Mailpit local catcher):
#   ACS_CONNECTION_STRING   ACS connection string (Key Vault in production)
#   ACS_SENDER_ADDRESS      Verified sender, e.g. noreply@partyhause.uk
#   RESEND_API_KEY          Resend API key (fallback provider)
#   RESEND_FROM_EMAIL       Verified Resend sender address
#   FRONTEND_URL            Base URL for links in email (reset/verify/invite)
_ACS_CONN = (os.environ.get('ACS_CONNECTION_STRING') or '').strip()
_ACS_SENDER = (os.environ.get('ACS_SENDER_ADDRESS') or '').strip()
_RESEND_KEY = (os.environ.get('RESEND_API_KEY') or '').strip()

if _ACS_CONN and _ACS_SENDER:
    EMAIL_BACKEND = 'partyhause.email_backends.AzureCommunicationEmailBackend'
    DEFAULT_FROM_EMAIL = _ACS_SENDER or 'PartyHause <noreply@partyhause.uk>'
    SERVER_EMAIL = DEFAULT_FROM_EMAIL
elif _RESEND_KEY:
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = 'smtp.resend.com'
    EMAIL_PORT = 587
    EMAIL_HOST_USER = 'resend'
    EMAIL_HOST_PASSWORD = _RESEND_KEY
    EMAIL_USE_TLS = True
    DEFAULT_FROM_EMAIL = (os.environ.get('RESEND_FROM_EMAIL') or '').strip() or 'PartyHause <noreply@partyhause.uk>'
    SERVER_EMAIL = DEFAULT_FROM_EMAIL
else:
    # Local development: Mailpit catches all outbound mail, nothing reaches
    # real inboxes. UI at http://localhost:8026 (compose) / 8025 (local).
    # Inside Docker, EMAIL_HOST must be the compose service name
    # 'partyhause-mailpit', not 'localhost' (which resolves to the container
    # itself).
    EMAIL_HOST = os.environ.get('EMAIL_HOST', '127.0.0.1')

    EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '1025'))
    EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
    EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
    EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'False').lower() == 'true'
    DEFAULT_FROM_EMAIL = 'PartyHause <dev@partyhause.local>'
    SERVER_EMAIL = 'PartyHause <dev@partyhause.local>'

# Base URL used for links in verification / password-reset / invitation email.
# Must be the publicly reachable frontend (e.g. https://partyhause.uk), not
# localhost, or real users cannot open the links.
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5173').rstrip('/')

# Invitation links are bearer credentials. Seven days is the same window the
# email says, and a re-send revokes the previous link.
INVITATION_TTL_DAYS = int(os.environ.get('INVITATION_TTL_DAYS', '7'))

# Azure Blob Storage. The connection string is provisioned by Bicep as a Key
# Vault reference; the account name/key pair is accepted for local use.
AZURE_STORAGE_CONNECTION_STRING = (
    os.environ.get('AZURE_STORAGE_CONNECTION_STRING') or ''
).strip()
AZURE_STORAGE_ACCOUNT = (os.environ.get('AZURE_STORAGE_ACCOUNT') or '').strip()
AZURE_STORAGE_ACCOUNT_KEY = (
    os.environ.get('AZURE_STORAGE_ACCOUNT_KEY') or ''
).strip()
AZURE_STORAGE_BLOB_ENDPOINT = (
    os.environ.get('AZURE_STORAGE_BLOB_ENDPOINT') or ''
).strip()
AZURE_STORAGE_IMAGE_CONTAINER = (
    os.environ.get('AZURE_STORAGE_IMAGE_CONTAINER') or 'event-invites'
).strip()

# Azure Web PubSub. The connection string is provisioned by Bicep as a Key
# Vault reference. When absent, /api/realtime/negotiate answers 503 and the
# client falls back to polling (src/hooks/use-realtime.ts).
WEBPUBSUB_CONNECTION_STRING = (
    os.environ.get('WEBPUBSUB_CONNECTION_STRING') or ''
).strip()
WEBPUBSUB_HUB = (os.environ.get('WEBPUBSUB_HUB') or 'partyhause').strip()

REST_FRAMEWORK = {
    # No default authentication: views use SessionAuthMixin to enforce the
    # Express session/state contract manually (401 = wipe session,
    # 403 = unverified but preserve session).
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.UserRateThrottle',
        'rest_framework.throttling.AnonRateThrottle',
    ],
    # The key is DEFAULT_THROTTLE_RATES (plural). The previous singular key
    # was silently ignored by DRF, so no throttling was applied at all.
    'DEFAULT_THROTTLE_RATES': {
        'user': os.environ.get('THROTTLE_USER_RATE', '2000/day'),
        'anon': os.environ.get('THROTTLE_ANON_RATE', '200/day'),
        'email': os.environ.get('THROTTLE_EMAIL_RATE', '20/5m'),
        'auth': os.environ.get('THROTTLE_AUTH_RATE', '20/15m'),
    },
}
