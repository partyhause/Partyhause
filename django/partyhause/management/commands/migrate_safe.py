"""
Advisory-lock migration runner.

Django migrations are not concurrency-safe: if two containers start
simultaneously, both may try to run migrations and corrupt the
`django_migrations` table or leave the schema half-applied. This command
acquires a PostgreSQL advisory lock (keyed by a stable hash) before running
`migrate`, so only one container at a time can apply migrations. Others wait
with a configurable timeout and then exit 0 if the lock holder succeeded, or
propagate the failure if it failed.

Usage:
    python manage.py migrate_safe [--lock-timeout SECONDS] [--wait-timeout SECONDS]
"""

import hashlib
import os
import time

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connection


LOCK_KEY = int(
    hashlib.sha256(b'partyhause_migrations').hexdigest()[:16], 16
) & 0x7FFFFFFF  # 31-bit signed for pg_advisory_lock


class Command(BaseCommand):
    help = 'Run Django migrations under a PostgreSQL advisory lock.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--lock-timeout',
            type=int,
            default=int(os.environ.get('MIGRATE_LOCK_TIMEOUT', '300')),
            help='Seconds to wait for the advisory lock (default 300).',
        )
        parser.add_argument(
            '--wait-timeout',
            type=int,
            default=int(os.environ.get('MIGRATE_WAIT_TIMEOUT', '600')),
            help='Seconds to wait for the lock holder to finish (default 600).',
        )
        parser.add_argument(
            '--plan-only',
            action='store_true',
            help='Show migration plan without acquiring lock or applying.',
        )

    def handle(self, *args, **options):
        if options['plan_only']:
            call_command('migrate', '--plan')
            return

        lock_timeout = options['lock_timeout']
        wait_timeout = options['wait_timeout']

        with connection.cursor() as cursor:
            # Try to acquire the lock with a timeout.
            # pg_try_advisory_lock returns true/false immediately.
            self.stdout.write('Waiting for migration lock...')
            start = time.time()
            got = False
            while time.time() - start < lock_timeout:
                cursor.execute('SELECT pg_try_advisory_lock(%s)', [LOCK_KEY])
                row = cursor.fetchone()
                if row and row[0]:
                    got = True
                    break
                time.sleep(1)

            if not got:
                self.stderr.write(
                    self.style.ERROR(
                        f'Could not acquire migration lock after {lock_timeout}s'
                    )
                )
                return 1

            self.stdout.write(self.style.SUCCESS('Migration lock acquired'))

            try:
                # Run the actual migrations.
                call_command('migrate', '--noinput')
                self.stdout.write(self.style.SUCCESS('Migrations applied'))
            except Exception as e:
                self.stderr.write(self.style.ERROR(f'Migration failed: {e}'))
                raise
            finally:
                # Release the lock.
                cursor.execute('SELECT pg_advisory_unlock(%s)', [LOCK_KEY])
                self.stdout.write('Migration lock released')