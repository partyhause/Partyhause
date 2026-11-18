# Create the templates and template_usage tables in the database.
#
# 0001_initial created these models with managed=False (Prisma was source of
# truth), so no tables were actually created. This migration uses
# SeparateDatabaseAndState to:
#   1. Create the actual database tables (database_operations)
#   2. Update Django's model state to managed=True (state_operations)
#
# This works on both fresh databases and databases where 0001_initial was
# already applied with managed=False.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('event_templates', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterModelOptions(
                    name='eventtemplate',
                    options={'managed': True},
                ),
                migrations.AlterModelOptions(
                    name='templateusage',
                    options={'managed': True},
                ),
            ],
            database_operations=[
                migrations.CreateModel(
                    name='EventTemplate',
                    fields=[
                        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ('name', models.CharField(max_length=255)),
                        ('slug', models.CharField(max_length=255, unique=True)),
                        ('description', models.TextField(blank=True, null=True)),
                        ('category', models.CharField(default='other', max_length=50)),
                        ('hero_image_url', models.URLField(blank=True, null=True)),
                        ('price_tier', models.CharField(default='free', max_length=20)),
                        ('default_payload', models.JSONField(default=dict)),
                        ('required_fields_schema', models.JSONField(blank=True, null=True)),
                        ('featured', models.BooleanField(default=False)),
                        ('published', models.BooleanField(default=True)),
                        ('usage_count', models.IntegerField(default=0)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        'db_table': 'templates',
                        'managed': True,
                    },
                ),
                migrations.CreateModel(
                    name='TemplateUsage',
                    fields=[
                        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ('event_id', models.UUIDField(blank=True, null=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('template', models.ForeignKey(db_column='template_id', on_delete=django.db.models.deletion.CASCADE, related_name='template_usage', to='event_templates.eventtemplate')),
                        ('user', models.ForeignKey(db_column='user_id', on_delete=django.db.models.deletion.CASCADE, related_name='template_usage_records', to=settings.AUTH_USER_MODEL)),
                    ],
                    options={
                        'db_table': 'template_usage',
                        'managed': True,
                    },
                ),
            ],
        ),
    ]
