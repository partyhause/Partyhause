from django.db.models import Count, Q
from .models import Guest
from events.models import Event
from datetime import datetime, timedelta
from django.utils import timezone

class RSVPStatsService:
    def __init__(self, event):
        self.event = event
    
    def get_overview(self):
        """Get comprehensive RSVP overview"""
        guests = Guest.objects.filter(event=self.event)
        total = guests.count()
        
        stats = {
            'total_invited': total,
            'accepted': guests.filter(rsvp_status='accepted').count(),
            'declined': guests.filter(rsvp_status='declined').count(),
            'maybe': guests.filter(rsvp_status='maybe').count(),
            'pending': guests.filter(rsvp_status='pending').count(),
            'checked_in': guests.filter(checked_in=True).count(),
            'response_rate': self._calculate_response_rate(guests),
            'capacity_used': self._calculate_capacity_used(guests),
            'email_stats': self._get_email_stats(guests)
        }
        
        return stats
    
    def _calculate_response_rate(self, guests):
        total = guests.count()
        if total == 0:
            return 0
        responded = guests.exclude(rsvp_status='pending').count()
        return round((responded / total) * 100, 1)
    
    def _calculate_capacity_used(self, guests):
        if self.event.max_guests <= 0:
            return 0
        accepted = guests.filter(rsvp_status='accepted').count()
        return round((accepted / self.event.max_guests) * 100, 1)
    
    def _get_email_stats(self, guests):
        emails = guests.filter(email_status__isnull=False)
        return {
            'sent': emails.filter(email_status='sent').count(),
            'delivered': emails.filter(email_status='delivered').count(),
            'opened': emails.filter(email_status='opened').count(),
            'clicked': emails.filter(email_status='clicked').count(),
            'bounced': emails.filter(email_status='bounced').count(),
            'failed': emails.filter(email_status='failed').count()
        }
    
    def get_response_trends(self, days=30):
        """Get RSVP response trends over time"""
        end_date = timezone.now()
        start_date = end_date - timedelta(days=days)
        
        daily_responses = []
        current = start_date
        
        while current <= end_date:
            next_day = current + timedelta(days=1)
            count = Guest.objects.filter(
                event=self.event,
                rsvp_responded_at__gte=current,
                rsvp_responded_at__lt=next_day
            ).count()
            
            daily_responses.append({
                'date': current.date(),
                'responses': count
            })
            
            current = next_day
        
        return daily_responses
    
    def get_guest_segments(self):
        """Segment guests by various criteria"""
        guests = Guest.objects.filter(event=self.event)
        
        return {
            'by_rsvp_status': guests.values('rsvp_status').annotate(count=Count('id')),
            'by_email_status': guests.values('email_status').annotate(count=Count('id')),
            'by_check_in': {
                'checked_in': guests.filter(checked_in=True).count(),
                'not_checked_in': guests.filter(checked_in=False).count()
            },
            'by_domain': guests.values('normalized_email__domain').annotate(count=Count('id')).order_by('-count')[:10]
        }
    
    def export_report(self, format='json'):
        """Export RSVP report in various formats"""
        stats = self.get_overview()
        trends = self.get_response_trends()
        segments = self.get_guest_segments()
        
        report = {
            'event_id': str(self.event.id),
            'event_name': self.event.name,
            'generated_at': timezone.now().isoformat(),
            'stats': stats,
            'trends': trends,
            'segments': segments
        }
        
        if format == 'json':
            import json
            return json.dumps(report, indent=2, default=str)
        elif format == 'csv':
            return self._export_to_csv(report)
        
        return report
    
    def _export_to_csv(self, report):
        """Export guest list to CSV"""
        import csv
        from io import StringIO
        
        output = StringIO()
        writer = csv.writer(output)
        
        # Header
        writer.writerow(['Name', 'Email', 'RSVP Status', 'Checked In', 'Email Status', 'Created At'])
        
        # Data
        guests = Guest.objects.filter(event=self.event)
        for guest in guests:
            writer.writerow([
                guest.name,
                guest.email,
                guest.rsvp_status,
                guest.checked_in,
                guest.email_status or '',
                guest.created_at
            ])
        
        return output.getvalue()
