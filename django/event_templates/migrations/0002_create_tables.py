# Manually created migration to create the templates and template_usage tables.
# These tables are managed by Django now (managed=True) instead of Prisma.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('event_templates', '0001_initial'),
    ]

    operations = [
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
    ]
