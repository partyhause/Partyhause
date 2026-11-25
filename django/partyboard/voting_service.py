from django.db import transaction
from django.core.cache import cache
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from .models import PartyBoardSticky, PartyBoardStickyVote

class StickyVotingService:
    def __init__(self, event):
        self.event = event
        self.channel_layer = get_channel_layer()
    
    @transaction.atomic
    def vote_on_sticky(self, sticky_id, user, cancel_vote=False):
        """Vote on sticky with real-time updates"""
        try:
            sticky = PartyBoardSticky.objects.select_for_update().get(
                id=sticky_id,
                event=self.event
            )
            
            if cancel_vote:
                vote_obj, created = PartyBoardStickyVote.objects.get_or_create(
                    sticky=sticky,
                    user=user,
                    defaults={'user_id': user.id}
                )
                
                if not created and vote_obj:
                    vote_obj.delete()
                    sticky.votes = max(0, sticky.votes - 1)
                    sticky.save()
                    
                    # Broadcast vote removal
                    self._broadcast_vote_update(sticky, user, action='removed')
                    
                    return {'action': 'removed', 'votes': sticky.votes}
            
            # Check if user already voted
            existing_vote = PartyBoardStickyVote.objects.filter(
                sticky=sticky,
                user=user
            ).first()
            
            if existing_vote:
                return {'action': 'already_voted', 'votes': sticky.votes}
            
            # Create vote
            PartyBoardStickyVote.objects.create(
                sticky=sticky,
                user=user
            )
            
            sticky.votes += 1
            sticky.save()
            
            # Broadcast vote update
            self._broadcast_vote_update(sticky, user, action='added')
            
            # Cache update for quick access
            cache_key = f"sticky_votes:{sticky.id}"
            cache.set(cache_key, sticky.votes, timeout=300)
            
            return {'action': 'added', 'votes': sticky.votes}
            
        except PartyBoardSticky.DoesNotExist:
            return {'error': 'Sticky not found'}, 404
        except Exception as e:
            return {'error': str(e)}, 500
    
    def _broadcast_vote_update(self, sticky, user, action):
        """Broadcast vote update to WebSocket channel"""
        if not self.channel_layer:
            return
        
        try:
            async_to_sync(self.channel_layer.group_send)(
                f"partyboard_{self.event.id}",
                {
                    'type': 'sticky_vote_update',
                    'sticky_id': str(sticky.id),
                    'votes': sticky.votes,
                    'user_id': str(user.id) if user else None,
                    'action': action,
                    'timestamp': timezone.now().isoformat()
                }
            )
        except Exception:
            pass
    
    def get_vote_count(self, sticky_id):
        """Get vote count with cache"""
        cache_key = f"sticky_votes:{sticky_id}"
        cached_count = cache.get(cache_key)
        
        if cached_count is not None:
            return cached_count
        
        try:
            sticky = PartyBoardSticky.objects.get(id=sticky_id)
            count = sticky.votes
            cache.set(cache_key, count, timeout=300)
            return count
        except PartyBoardSticky.DoesNotExist:
            return 0
    
    def get_user_votes(self, user):
        """Get all stickies voted by user"""
        return PartyBoardStickyVote.objects.filter(
            user=user,
            sticky__event=self.event
        ).select_related('sticky')
    
    def get_top_stickies(self, limit=10):
        """Get stickies with most votes"""
        return PartyBoardSticky.objects.filter(
            event=self.event
        ).order_by('-votes')[:limit]
