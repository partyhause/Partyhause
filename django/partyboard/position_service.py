from django.db import transaction
from django.core.cache import cache
from .models import PartyBoardSticky
import json

class PositionPersistenceService:
    def __init__(self, event):
        self.event = event
        self.cache_key = f"partyboard_positions:{event.id}"
    
    @transaction.atomic
    def update_positions(self, positions_data, user):
        """Update positions for multiple stickies"""
        results = []
        
        for item in positions_data:
            try:
                sticky_id = item['id']
                x = float(item.get('x', 0))
                y = float(item.get('y', 0))
                
                sticky = PartyBoardSticky.objects.select_for_update().get(
                    id=sticky_id,
                    event=self.event
                )
                
                # Update position
                sticky.position_x = x
                sticky.position_y = y
                sticky.updated_at = timezone.now()
                sticky.save()
                
                # Cache position
                cache_key = f"sticky_pos:{sticky.id}"
                cache.set(cache_key, {'x': x, 'y': y}, timeout=3600)
                
                results.append({
                    'id': str(sticky.id),
                    'success': True,
                    'position': {'x': x, 'y': y}
                })
                
            except PartyBoardSticky.DoesNotExist:
                results.append({
                    'id': sticky_id,
                    'success': False,
                    'error': 'Sticky not found'
                })
            except Exception as e:
                results.append({
                    'id': sticky_id,
                    'success': False,
                    'error': str(e)
                })
        
        # Update cache for bulk positions
        self._update_cache_snapshot(positions_data)
        
        return results
    
    def _update_cache_snapshot(self, positions_data):
        """Update cache snapshot for quick loading"""
        all_positions = {}
        
        # Get existing cached positions
        cached = cache.get(self.cache_key)
        if cached:
            all_positions = json.loads(cached)
        
        # Update with new positions
        for item in positions_data:
            all_positions[item['id']] = {
                'x': item.get('x', 0),
                'y': item.get('y', 0)
            }
        
        # Cache for 1 hour
        cache.set(
            self.cache_key,
            json.dumps(all_positions),
            timeout=3600
        )
    
    def get_all_positions(self):
        """Get all sticky positions from cache or DB"""
        # Try cache first
        cached = cache.get(self.cache_key)
        if cached:
            return json.loads(cached)
        
        # Fall back to DB
        stickies = PartyBoardSticky.objects.filter(event=self.event)
        positions = {
            str(sticky.id): {
                'x': sticky.position_x,
                'y': sticky.position_y
            }
            for sticky in stickies
        }
        
        # Cache result
        cache.set(
            self.cache_key,
            json.dumps(positions),
            timeout=3600
        )
        
        return positions
    
    def save_layout(self, layout_name, positions_data):
        """Save a specific layout configuration"""
        layout_key = f"partyboard_layout:{self.event.id}:{layout_name}"
        
        cache.set(
            layout_key,
            json.dumps(positions_data),
            timeout=86400 * 7  # Keep for 7 days
        )
        
        return True
    
    def load_layout(self, layout_name):
        """Load a saved layout configuration"""
        layout_key = f"partyboard_layout:{self.event.id}:{layout_name}"
        
        cached = cache.get(layout_key)
        if cached:
            return json.loads(cached)
        
        return None
    
    def export_layout(self):
        """Export current layout as JSON"""
        stickies = PartyBoardSticky.objects.filter(event=self.event)
        
        layout = []
        for sticky in stickies:
            layout.append({
                'id': str(sticky.id),
                'content': sticky.content,
                'color': sticky.color,
                'position_x': sticky.position_x,
                'position_y': sticky.position_y,
                'votes': sticky.votes
            })
        
        return layout
