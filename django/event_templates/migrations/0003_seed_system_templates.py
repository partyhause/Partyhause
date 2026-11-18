# Seed system templates into the templates table.
# Run after 0002_create_tables creates the table.

import json
import os
from django.db import migrations


def seed_templates(apps, schema_editor):
    EventTemplate = apps.get_model('event_templates', 'EventTemplate')
    seed_dir = os.path.join(os.path.dirname(__file__), 'seed_data')
    if not os.path.isdir(seed_dir):
        return
    for filename in sorted(os.listdir(seed_dir)):
        if not filename.endswith('.json'):
            continue
        with open(os.path.join(seed_dir, filename), 'r') as f:
            data = json.load(f)
        EventTemplate.objects.update_or_create(
            slug=data['slug'],
            defaults={
                'name': data['name'],
                'description': data.get('description', ''),
                'category': data.get('category', 'other'),
                'hero_image_url': data.get('hero_image_url') or None,
                'price_tier': data.get('price_tier', 'free'),
                'default_payload': data.get('default_payload', {}),
                'required_fields_schema': data.get('required_fields_schema') or None,
                'featured': data.get('featured', False),
                'published': data.get('published', True),
                'usage_count': data.get('usage_count', 0),
                'author_id': data.get('author_id') or None,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ('event_templates', '0002_create_tables'),
    ]

    operations = [
        migrations.RunPython(seed_templates, migrations.RunPython.noop),
    ]
