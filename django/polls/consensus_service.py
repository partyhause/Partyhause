from django.utils import timezone
from django.db.models import Count
from .models import Poll, PollOption, PollVote
from django.core.cache import cache

class PollConsensusService:
    CONSENSUS_THRESHOLDS = {
        'majority': 51,
        'supermajority': 66,
        'unanimous': 100
    }
    
    def __init__(self, poll):
        self.poll = poll
    
    def check_consensus(self, threshold_type='majority'):
        """Check if poll has reached consensus threshold"""
        threshold = self.CONSENSUS_THRESHOLDS.get(threshold_type, 51)
        
        # Get vote counts
        options = PollOption.objects.filter(poll=self.poll).annotate(
            vote_count=Count('votes')
        )
        
        total_votes = sum(opt.vote_count for opt in options)
        
        if total_votes == 0:
            return {
                'has_consensus': False,
                'threshold': threshold,
                'winning_option': None,
                'confidence': 0
            }
        
        # Find option with most votes
        top_option = max(options, key=lambda x: x.vote_count)
        percentage = (top_option.vote_count / total_votes) * 100
        
        has_consensus = percentage >= threshold
        
        return {
            'has_consensus': has_consensus,
            'threshold': threshold,
            'threshold_type': threshold_type,
            'winning_option': {
                'id': str(top_option.id),
                'text': top_option.text,
                'votes': top_option.vote_count,
                'percentage': round(percentage, 1)
            },
            'confidence': round(percentage, 1),
            'total_votes': total_votes,
            'checked_at': timezone.now().isoformat()
        }
    
    def auto_close_on_consensus(self):
        """Auto-close poll if consensus reached"""
        try:
            # Check for unanimous consensus first
            consensus = self.check_consensus('unanimous')
            if consensus['has_consensus']:
                self._close_poll('unanimous_consensus')
                return consensus
            
            # Check for supermajority
            consensus = self.check_consensus('supermajority')
            if consensus['has_consensus']:
                self._close_poll('supermajority_consensus')
                return consensus
            
            # Check for majority
            consensus = self.check_consensus('majority')
            if consensus['has_consensus']:
                self._close_poll('majority_consensus')
                return consensus
            
            return {'has_consensus': False}
            
        except Exception as e:
            return {'error': str(e)}
    
    def _close_poll(self, reason):
        """Close poll and record reason"""
        self.poll.is_active = False
        self.poll.closed_at = timezone.now()
        self.poll.close_reason = reason
        self.poll.save()
        
        # Cache result
        cache_key = f"poll_closed:{self.poll.id}"
        cache.set(cache_key, {
            'reason': reason,
            'closed_at': timezone.now().isoformat()
        }, timeout=86400)
    
    def get_consensus_history(self):
        """Get history of consensus checks"""
        cache_key = f"consensus_history:{self.poll.id}"
        history = cache.get(cache_key, [])
        
        return history
    
    def record_consensus_check(self, result):
        """Record consensus check in history"""
        cache_key = f"consensus_history:{self.poll.id}"
        history = cache.get(cache_key, [])
        
        history.append({
            'timestamp': timezone.now().isoformat(),
            'result': result
        })
        
        # Keep last 100 checks
        if len(history) > 100:
            history = history[-100:]
        
        cache.set(cache_key, history, timeout=86400 * 7)
