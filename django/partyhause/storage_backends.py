from storages.backends.azure_storage import AzureStorage

class AzureMediaStorage(AzureStorage):
    account_name = 'stphk2xoe7s452aja'
    azure_container = 'uploads'
    expiration_secs = None
