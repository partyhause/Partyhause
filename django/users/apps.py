from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'users'

    def ready(self):
        # Import signal handlers to register them (UserProfile auto-creation).
        import users.signals  # noqa: F401
