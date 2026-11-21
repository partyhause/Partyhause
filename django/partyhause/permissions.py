from rest_framework.permissions import BasePermission

class IsEventHost(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.host_id == request.user.id

class IsGuest(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.user_id == request.user.id or obj.event.host_id == request.user.id
