from django.db.models import Count
from django.db.models.functions import Round
from .models import Poll, PollOption, PollVote
from django.utils import timezone

class PollResultsService:
    def __init__(self, poll):
        self.poll = poll
    
    def calculate_results(self):
        """Calculate poll results with percentages"""
        total_votes = PollVote.objects.filter(poll=self.poll).count()
        
        if total_votes == 0:
            return {
                'total_votes': 0,
                'options': [],
                'winner': None
            }
        
        options_with_votes = PollOption.objects.filter(poll=self.poll).annotate(
            vote_count=Count('votes')
        ).order_by('-vote_count')
        
        results = []
        max_votes = 0
        winners = []
        
        for option in options_with_votes:
            vote_count = option.vote_count
            percentage = round((vote_count / total_votes) * 100, 1) if total_votes > 0 else 0
            
            if vote_count > max_votes:
                max_votes = vote_count
                winners = [option]
            elif vote_count == max_votes and vote_count > 0:
                winners.append(option)
            
            results.append({
                'option_id': str(option.id),
                'option_text': option.text,
                'votes': vote_count,
                'percentage': percentage
            })
        
        winner_options = [{
            'option_id': str(w.id),
            'option_text': w.text,
            'votes': w.vote_count,
            'percentage': round((w.vote_count / total_votes) * 100, 1)
        } for w in winners[:3]] if winners else []
        
        return {
            'poll_id': str(self.poll.id),
            'question': self.poll.question,
            'total_votes': total_votes,
            'options': results,
            'winners': winner_options,
            'is_tie': len(winners) > 1,
            'calculated_at': timezone.now().isoformat()
        }
    
    def has_consensus(self, threshold=51):
        """Check if poll has reached consensus threshold"""
        result = self.calculate_results()
        
        if result['total_votes'] == 0:
            return False, 0
        
        # Check if any option has reached threshold
        for option in result['options']:
            if option['percentage'] >= threshold:
                return True, option['percentage']
        
        return False, 0
    
    def get_voter_breakdown(self):
        """Get breakdown of votes by voter"""
        votes = PollVote.objects.filter(poll=self.poll).select_related(
            'option', 'voter'
        )
        
        breakdown = {}
        for vote in votes:
            option_text = vote.option.text
            voter_name = vote.voter.email if vote.voter else 'Anonymous'
            
            if option_text not in breakdown:
                breakdown[option_text] = []
            
            breakdown[option_text].append({
                'voter': voter_name,
                'voted_at': vote.created_at.isoformat() if vote.created_at else None
            })
        
        return breakdown
    
    def get_participation_rate(self, event_guests):
        """Calculate participation rate vs total guests"""
        total_guests = event_guests.count()
        if total_guests == 0:
            return 0
        
        voters = PollVote.objects.filter(poll=self.poll).values('voter').distinct().count()
        return round((voters / total_guests) * 100, 1)
