from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop


class UploadView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({'url': ''})


class BlobView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def delete(self, request, blob_name):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response(status=status.HTTP_204_NO_CONTENT)


class UrlView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request, blob_name):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        return Response({'url': ''})
