from django.test import TestCase, override_settings
from django.core.files.base import ContentFile
from partyhause.storage_backends import AzureMediaStorage

class StorageTests(TestCase):
    def test_azure_storage_config(self):
        storage = AzureMediaStorage()
        self.assertEqual(storage.account_name, 'stphk2xoe7s452aja')
        self.assertEqual(storage.azure_container, 'uploads')

    @override_settings(DEFAULT_FILE_STORAGE='partyhause.storage_backends.AzureMediaStorage')
    def test_file_save(self):
        from django.core.files.storage import default_storage
        storage = default_storage
        name = storage.save('test.txt', ContentFile(b'hello'))
        self.assertTrue(storage.exists(name))
        storage.delete(name)
