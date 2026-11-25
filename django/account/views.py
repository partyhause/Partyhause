from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated


class AccountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({})


class DeletionIntentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        return Response({})


class DeletionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        return Response({})
