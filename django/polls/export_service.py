import csv
import json
from io import StringIO, BytesIO
from django.http import HttpResponse
from .models import Poll, PollOption, PollVote

class PollExportService:
    def __init__(self, poll):
        self.poll = poll
    
    def export_csv(self):
        """Export poll data to CSV"""
        output = StringIO()
        writer = csv.writer(output)
        
        # Header
        writer.writerow([
            'Poll Question',
            'Option',
            'Voter Email',
            'Vote Timestamp'
        ])
        
        # Get all votes
        votes = PollVote.objects.filter(poll=self.poll).select_related(
            'option', 'voter'
        )
        
        for vote in votes:
            writer.writerow([
                self.poll.question,
                vote.option.text,
                vote.voter.email if vote.voter else 'Anonymous',
                vote.created_at.isoformat() if vote.created_at else ''
            ])
        
        # Create HTTP response
        response = HttpResponse(
            output.getvalue(),
            content_type='text/csv'
        )
        response['Content-Disposition'] = f'attachment; filename="poll_{self.poll.id}_votes.csv"'
        
        return response
    
    def export_json(self):
        """Export poll results to JSON"""
        options = PollOption.objects.filter(poll=self.poll).annotate(
            vote_count=models.Count('votes')
        )
        
        data = {
            'poll_id': str(self.poll.id),
            'question': self.poll.question,
            'event_id': str(self.poll.event.id),
            'created_at': self.poll.created_at.isoformat() if self.poll.created_at else None,
            'is_active': self.poll.is_active,
            'options': [],
            'votes': []
        }
        
        total_votes = 0
        for option in options:
            option_data = {
                'id': str(option.id),
                'text': option.text,
                'votes': option.vote_count
            }
            data['options'].append(option_data)
            total_votes += option.vote_count
        
        # Add vote details
        votes = PollVote.objects.filter(poll=self.poll).select_related(
            'option', 'voter'
        )
        
        for vote in votes:
            data['votes'].append({
                'voter_email': vote.voter.email if vote.voter else 'Anonymous',
                'option': vote.option.text,
                'voted_at': vote.created_at.isoformat() if vote.created_at else None
            })
        
        data['total_votes'] = total_votes
        data['exported_at'] = timezone.now().isoformat()
        
        response = HttpResponse(
            json.dumps(data, indent=2),
            content_type='application/json'
        )
        response['Content-Disposition'] = f'attachment; filename="poll_{self.poll.id}_results.json"'
        
        return response
    
    def export_summary(self):
        """Export poll summary report"""
        from .results_service import PollResultsService
        
        results_service = PollResultsService(self.poll)
        results = results_service.calculate_results()
        
        summary = f"""
POLL SUMMARY REPORT
===================
Poll ID: {self.poll.id}
Question: {self.poll.question}
Event: {self.poll.event.name}
Created: {self.poll.created_at}
Total Votes: {results['total_votes']}

RESULTS:
--------
"""
        
        for option in results['options']:
            summary += f"{option['option_text']}: {option['votes']} votes ({option['percentage']}%)\n"
        
        if results['winners']:
            summary += f"\nWINNER(S):\n"
            for winner in results['winners']:
                summary += f"- {winner['option_text']} ({winner['percentage']}%)\n"
        
        summary += f"\nExported: {timezone.now().strftime('%Y-%m-%d %H:%M:%S')}"
        
        response = HttpResponse(summary, content_type='text/plain')
        response['Content-Disposition'] = f'attachment; filename="poll_{self.poll.id}_summary.txt"'
        
        return response
