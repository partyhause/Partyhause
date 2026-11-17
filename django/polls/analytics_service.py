from django.db.models import Count, Avg, Max, Min
from django.utils import timezone
from datetime import timedelta
from .models import Poll, PollOption, PollVote
import json

class PollAnalyticsService:
    def __init__(self, poll):
        self.poll = poll
    
    def get_voting_patterns(self):
        """Analyze voting patterns over time"""
        votes = PollVote.objects.filter(poll=self.poll).order_by('created_at')
        
        if not votes.exists():
            return {'patterns': [], 'insufficient_data': True}
        
        # Group votes by hour
        hourly_votes = {}
        for vote in votes:
            hour_key = vote.created_at.replace(minute=0, second=0, microsecond=0)
            hour_str = hour_key.isoformat()
            
            if hour_str not in hourly_votes:
                hourly_votes[hour_str] = 0
            hourly_votes[hour_str] += 1
        
        patterns = []
        for hour, count in sorted(hourly_votes.items()):
            patterns.append({
                'hour': hour,
                'votes': count
            })
        
        return {
            'patterns': patterns,
            'peak_hour': max(hourly_votes.items(), key=lambda x: x[1])[0] if hourly_votes else None,
            'total_votes': votes.count(),
            'voting_duration_hours': self._get_voting_duration(votes)
        }
    
    def _get_voting_duration(self, votes):
        """Calculate voting duration in hours"""
        if not votes.exists():
            return 0
        
        first_vote = votes.first().created_at
        last_vote = votes.last().created_at
        
        duration = last_vote - first_vote
        return duration.total_seconds() / 3600
    
    def get_option_preferences(self):
        """Analyze option preference patterns"""
        options = PollOption.objects.filter(poll=self.poll).annotate(
            vote_count=Count('votes')
        )
        
        total_votes = sum(opt.vote_count for opt in options)
        
        preferences = []
        for option in options:
            percentage = (option.vote_count / total_votes * 100) if total_votes > 0 else 0
            
            preferences.append({
                'option_id': str(option.id),
                'option_text': option.text,
                'votes': option.vote_count,
                'percentage': round(percentage, 1),
                'rank': 0  # Will be set after sorting
            })
        
        # Sort by votes and assign ranks
        preferences.sort(key=lambda x: x['votes'], reverse=True)
        for i, pref in enumerate(preferences, 1):
            pref['rank'] = i
        
        return {
            'preferences': preferences,
            'total_votes': total_votes,
            'voter_engagement': self._calculate_engagement()
        }
    
    def _calculate_engagement(self):
        """Calculate voter engagement score"""
        votes = PollVote.objects.filter(poll=self.poll)
        
        if not votes.exists():
            return 0
        
        # Engagement metrics
        unique_voters = votes.values('voter').distinct().count()
        total_options = PollOption.objects.filter(poll=self.poll).count()
        
        # Average votes per voter
        avg_votes_per_voter = votes.count() / unique_voters if unique_voters > 0 else 0
        
        return {
            'unique_voters': unique_voters,
            'avg_votes_per_voter': round(avg_votes_per_voter, 2),
            'engagement_score': min(100, int(avg_votes_per_voter * 25))
        }
    
    def compare_with_similar_polls(self):
        """Compare this poll with similar polls in same event"""
        similar_polls = Poll.objects.filter(
            event=self.poll.event,
            poll_type=self.poll.poll_type
        ).exclude(id=self.poll.id)
        
        comparisons = []
        for other_poll in similar_polls:
            other_votes = PollVote.objects.filter(poll=other_poll).count()
            this_votes = PollVote.objects.filter(poll=self.poll).count()
            
            comparisons.append({
                'poll_id': str(other_poll.id),
                'question': other_poll.question,
                'votes': other_votes,
                'vote_difference': this_votes - other_votes
            })
        
        return {
            'comparisons': comparisons,
            'average_votes': sum(c['votes'] for c in comparisons) / len(comparisons) if comparisons else 0
        }
    
    def generate_insights(self):
        """Generate automated insights from poll data"""
        results = self.get_option_preferences()
        patterns = self.get_voting_patterns()
        
        insights = []
        
        # Engagement insight
        engagement = results.get('voter_engagement', {})
        if engagement.get('engagement_score', 0) < 25:
            insights.append({
                'type': 'low_engagement',
                'message': 'Poll has low voter engagement. Consider sending reminders.'
            })
        
        # Consensus insight
        preferences = results.get('preferences', [])
        if preferences and len(preferences) > 0:
            top_option = preferences[0]
            if top_option['percentage'] >= 66:
                insights.append({
                    'type': 'strong_consensus',
                    'message': f'Strong consensus on "{top_option["option_text"]}" with {top_option["percentage"]}% support'
                })
            elif top_option['percentage'] >= 51:
                insights.append({
                    'type': 'moderate_consensus',
                    'message': f'Moderate consensus on "{top_option["option_text"]}" with {top_option["percentage"]}% support'
                })
        
        # Timing insight
        if patterns.get('voting_duration_hours', 0) > 48:
            insights.append({
                'type': 'long_voting_period',
                'message': 'Poll has been active for extended period. Consider closing soon.'
            })
        
        return {
            'insights': insights,
            'generated_at': timezone.now().isoformat()
        }
