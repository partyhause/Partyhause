import csv
import io
from django.core.exceptions import ValidationError
from .models import Guest
from events.models import Event

class GuestImportService:
    def __init__(self, event):
        self.event = event
        self.imported = []
        self.errors = []
        self.skipped = []
    
    def import_from_csv(self, csv_file):
        """Import guests from CSV file with columns: name,email,phone,role"""
        try:
            decoded_file = csv_file.read().decode('utf-8')
            io_string = io.StringIO(decoded_file)
            reader = csv.DictReader(io_string)
            
            for row_num, row in enumerate(reader, start=2):
                try:
                    name = row.get('name', '').strip()
                    email = row.get('email', '').strip()
                    phone = row.get('phone', '').strip()
                    role = row.get('role', 'guest').strip()
                    
                    if not name or not email:
                        self.errors.append(f"Row {row_num}: Name and email required")
                        continue
                    
                    normalized_email = email.lower().strip()
                    
                    # Check for duplicates
                    existing = Guest.objects.filter(
                        event=self.event,
                        normalized_email=normalized_email
                    ).first()
                    
                    if existing:
                        self.skipped.append(f"Row {row_num}: Guest {email} already exists")
                        continue
                    
                    # Check capacity
                    if not self.event.check_capacity():
                        self.errors.append(f"Row {row_num}: Event at capacity")
                        continue
                    
                    guest = Guest.objects.create(
                        event=self.event,
                        name=name,
                        email=email,
                        normalized_email=normalized_email,
                        phone=phone,
                        role=role,
                        rsvp_status='pending'
                    )
                    self.imported.append(guest)
                    
                except Exception as e:
                    self.errors.append(f"Row {row_num}: {str(e)}")
            
            return {
                'imported': len(self.imported),
                'skipped': len(self.skipped),
                'errors': len(self.errors),
                'details': {
                    'imported_guests': self.imported,
                    'skipped': self.skipped,
                    'errors': self.errors
                }
            }
            
        except Exception as e:
            raise ValidationError(f"CSV import failed: {str(e)}")
    
    def import_from_list(self, guests_data):
        """Import guests from list of dicts"""
        for data in guests_data:
            try:
                name = data.get('name', '').strip()
                email = data.get('email', '').strip()
                
                if not name or not email:
                    continue
                
                normalized_email = email.lower().strip()
                
                guest, created = Guest.objects.get_or_create(
                    event=self.event,
                    normalized_email=normalized_email,
                    defaults={
                        'name': name,
                        'email': email,
                        'phone': data.get('phone', ''),
                        'role': data.get('role', 'guest')
                    }
                )
                
                if created:
                    self.imported.append(guest)
                else:
                    self.skipped.append(f"Guest {email} already exists")
                    
            except Exception as e:
                self.errors.append(str(e))
        
        return {
            'imported': len(self.imported),
            'skipped': len(self.skipped),
            'errors': len(self.errors)
        }
