from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import PartyBoardSticky
from serializers.partyboard_serializer import PartyBoardStickySerializer

class PartyBoardStickyViewSet(viewsets.ModelViewSet):
    queryset = PartyBoardSticky.objects.all()
    serializer_class = PartyBoardStickySerializer
    permission_classes = [IsAuthenticated]
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
    @action(detail=True, methods=['post'])
    def vote(self, request, pk=None):
        sticky = self.get_object()
        voted = sticky.toggle_vote(request.user)
        serializer = self.get_serializer(sticky)
        return Response({
            'sticky': serializer.data,
            'voted': voted,
            'vote_count': sticky.vote_count
        })
    
    @action(detail=True, methods=['patch'])
    def position(self, request, pk=None):
        sticky = self.get_object()
        if sticky.created_by != request.user:
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        
        if 'position_x' in request.data:
            sticky.position_x = request.data['position_x']
        if 'position_y' in request.data:
            sticky.position_y = request.data['position_y']
        if 'z_index' in request.data:
            sticky.z_index = request.data['z_index']
        
        sticky.save()
        serializer = self.get_serializer(sticky)
        return Response(serializer.data)
