from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='event',
            name='imported_by',
            field=models.ForeignKey(
                blank=True,
                db_column='imported_by_id',
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='imported_events',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name='event',
            index=models.Index(fields=['imported_by'], name='events_imported_da_9c1a2e_idx'),
        ),
        migrations.AddConstraint(
            model_name='event',
            constraint=models.UniqueConstraint(
                condition=models.Q((models.Q(('imported_by__isnull', False),))),
                fields=['imported_by', 'external_source', 'external_event_id'],
                name='unique_external_event_per_user',
            ),
        ),
    ]
