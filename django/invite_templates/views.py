from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

from .models import InviteTemplate
from .serializers import InviteTemplateSerializer


def _get_template_or_404(template_id, user):
    """Fetch a template by ID, ensuring the caller is its author."""
    try:
        template = InviteTemplate.objects.get(id=template_id)
    except InviteTemplate.DoesNotExist:
        raise NotFound('Template not found')
    if template.author_id != user.id:
        raise PermissionDenied('You do not own this template')
    return template


class InviteTemplateListView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def get(self, request):
        """List templates owned by the authenticated user."""
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        templates = InviteTemplate.objects.filter(author=request.user).order_by('-created_at')
        serializer = InviteTemplateSerializer(templates, many=True)
        return Response({'templates': serializer.data})

    def post(self, request):
        """Create a new template owned by the authenticated user."""
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        serializer = InviteTemplateSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(author=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class InviteTemplateDetailView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def put(self, request, template_id):
        """Update a template owned by the authenticated user."""
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        template = _get_template_or_404(template_id, request.user)
        serializer = InviteTemplateSerializer(template, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, template_id):
        """Delete a template owned by the authenticated user."""
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        template = _get_template_or_404(template_id, request.user)
        template.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
