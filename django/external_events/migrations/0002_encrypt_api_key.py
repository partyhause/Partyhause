from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('external_events', '0001_initial'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='externalproviderconfig',
            name='api_key_enc',
        ),
        migrations.AddField(
            model_name='externalproviderconfig',
            name='api_key_encrypted',
            field=models.BinaryField(blank=True, null=True),
        ),
    ]
