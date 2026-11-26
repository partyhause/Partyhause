import mimetypes
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from pathlib import Path

from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin

try:  # imported lazily so a checkout without the SDK still runs `manage.py check`
    from azure.core.exceptions import ResourceExistsError
    from azure.storage.blob import (
        BlobSasPermissions,
        BlobServiceClient,
        ContentSettings,
        generate_blob_sas,
    )
except ImportError:  # pragma: no cover - production installs requirements.txt
    BlobServiceClient = None
    BlobSasPermissions = None
    ContentSettings = None
    generate_blob_sas = None
    ResourceExistsError = Exception

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
}


def _service():
    if BlobServiceClient is None:
        return None
    connection_string = getattr(settings, 'AZURE_STORAGE_CONNECTION_STRING', '')
    if connection_string:
        return BlobServiceClient.from_connection_string(connection_string)
    account = getattr(settings, 'AZURE_STORAGE_ACCOUNT', '')
    key = getattr(settings, 'AZURE_STORAGE_ACCOUNT_KEY', '')
    if account and key:
        endpoint = getattr(settings, 'AZURE_STORAGE_BLOB_ENDPOINT', '') or (
            f'https://{account}.blob.core.windows.net'
        )
        return BlobServiceClient(account_url=endpoint, credential=key)
    return None


def _container_name():
    return getattr(settings, 'AZURE_STORAGE_IMAGE_CONTAINER', 'event-invites')


def _safe_folder(value):
    raw = (value or 'uploads').strip().strip('/')
    parts = [part for part in raw.split('/') if part not in ('', '.', '..')]
    cleaned = '/'.join(part for part in parts if all(c.isalnum() or c in '-_' for c in part))
    return cleaned or 'uploads'


def _extension(upload, content_type):
    suffix = Path(upload.name or '').suffix.lower()
    if suffix in {'.jpg', '.jpeg', '.png', '.webp', '.gif'}:
        return '.jpg' if suffix == '.jpeg' else suffix
    return ALLOWED_CONTENT_TYPES.get(content_type, mimetypes.guess_extension(content_type) or '.bin')


class UploadView(SessionAuthMixin, APIView):
    """POST /api/storage/upload/ — upload an image through the API."""

    def post(self, request):
        upload = request.FILES.get('file')
        if upload is None:
            return Response(
                {'error': 'file is required', 'code': 'FILE_REQUIRED'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if upload.size > MAX_UPLOAD_BYTES:
            return Response(
                {'error': 'File exceeds the 5 MB limit', 'code': 'FILE_TOO_LARGE'},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        content_type = (upload.content_type or '').lower().split(';')[0]
        if content_type not in ALLOWED_CONTENT_TYPES:
            return Response(
                {
                    'error': 'Only JPEG, PNG, WebP, and GIF images are allowed',
                    'code': 'UNSUPPORTED_MEDIA_TYPE',
                },
                status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            )

        service = _service()
        if service is None:
            return Response(
                {'error': 'Storage is not configured', 'code': 'STORAGE_NOT_CONFIGURED'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        folder = _safe_folder(request.data.get('folder'))
        extension = _extension(upload, content_type)
        blob_name = f'{folder}/{request.user.id}/{uuid.uuid4().hex}{extension}'
        container = _container_name()

        try:
            container_client = service.get_container_client(container)
            try:
                container_client.create_container()
            except ResourceExistsError:
                pass
            blob_client = container_client.get_blob_client(blob_name)
            blob_client.upload_blob(
                upload,
                overwrite=False,
                content_settings=ContentSettings(content_type=content_type),
            )
        except Exception:
            return Response(
                {'error': 'Upload failed', 'code': 'UPLOAD_FAILED'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response(
            {
                'url': blob_client.url,
                'blobName': blob_name,
                'success': True,
            },
            status=status.HTTP_201_CREATED,
        )


class BlobView(SessionAuthMixin, APIView):
    """DELETE /api/storage/:blobName/ — delete an uploaded blob."""

    def delete(self, request, blob_name):
        # Blob names are paths (`uploads/<user>/<file>`), so the URL route uses
        # <path:...>. A caller may only delete inside their own prefix.
        prefix = f'uploads/{request.user.id}/'
        if not blob_name.startswith(prefix):
            return Response(
                {'error': 'Blob not found', 'code': 'BLOB_NOT_FOUND'},
                status=status.HTTP_404_NOT_FOUND,
            )

        service = _service()
        if service is None:
            return Response(
                {'error': 'Storage is not configured', 'code': 'STORAGE_NOT_CONFIGURED'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            service.get_blob_client(_container_name(), blob_name).delete_blob()
        except Exception:
            return Response(
                {'error': 'Blob not found', 'code': 'BLOB_NOT_FOUND'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({'success': True}, status=status.HTTP_200_OK)


class UrlView(SessionAuthMixin, APIView):
    """GET /api/storage/url/:blobName/ — resolve a public or SAS URL."""

    def get(self, request, blob_name):
        service = _service()
        if service is None:
            return Response(
                {'error': 'Storage is not configured', 'code': 'STORAGE_NOT_CONFIGURED'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        blob_client = service.get_blob_client(_container_name(), blob_name)
        url = blob_client.url

        account = getattr(settings, 'AZURE_STORAGE_ACCOUNT', '')
        key = getattr(settings, 'AZURE_STORAGE_ACCOUNT_KEY', '')
        if account and key and generate_blob_sas is not None:
            sas = generate_blob_sas(
                account_name=account,
                container_name=_container_name(),
                blob_name=blob_name,
                account_key=key,
                permission=BlobSasPermissions(read=True),
                expiry=datetime.now(dt_timezone.utc) + timedelta(hours=1),
            )
            url = f'{url}?{sas}'

        return Response({'url': url, 'success': True})
