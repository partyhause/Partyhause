from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0001_initial'),
        ('accounts', '__latest__'),
    ]

    operations = [
        migrations.CreateModel(
            name='ExternalProviderConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(max_length=50, unique=True)),
                ('name', models.CharField(max_length=100)),
                ('enabled', models.BooleanField(default=False)),
                ('api_key_enc', models.CharField(blank=True, max_length=2000, null=True)),
                ('config_json', models.JSONField(blank=True, default=dict)),
                ('rate_limit_per_hour', models.IntegerField(default=60)),
                ('last_sync_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'external_provider_config',
                'ordering': ['slug'],
            },
        ),
        migrations.CreateModel(
            name='ExternalSyncRun',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('provider', models.CharField(max_length=100, db_index=True)),
                ('status', models.CharField(default='queued', max_length=20)),
                ('events_fetched', models.IntegerField(default=0)),
                ('events_inserted', models.IntegerField(default=0)),
                ('events_updated', models.IntegerField(default=0)),
                ('error', models.TextField(blank=True, null=True)),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('finished_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='external_sync_runs', to='accounts.user')),
            ],
            options={
                'db_table': 'external_sync_run',
                'ordering': ['-started_at'],
            },
        ),
    ]
