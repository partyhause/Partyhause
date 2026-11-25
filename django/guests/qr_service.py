import qrcode
import secrets
import base64
from io import BytesIO
from django.conf import settings
from django.utils import timezone
from django.core.cache import cache
from .models import Guest

class GuestQRService:
    def __init__(self, event):
        self.event = event
    
    def generate_qr_code(self, guest, size=300):
        """Generate QR code for guest check-in"""
        # Generate unique check-in token
        checkin_token = self._generate_checkin_token(guest)
        
        # Create QR data
        qr_data = {
            'event_id': str(self.event.id),
            'guest_id': str(guest.id),
            'token': checkin_token,
            'name': guest.name
        }
        
        import json
        qr_payload = base64.b64encode(json.dumps(qr_data).encode()).decode()
        
        # Generate QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_H,
            box_size=10,
            border=4
        )
        qr.add_data(qr_payload)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Convert to base64 for storage
        buffered = BytesIO()
        img.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        
        return {
            'qr_code': f'data:image/png;base64,{img_str}',
            'checkin_token': checkin_token,
            'payload': qr_payload
        }
    
    def _generate_checkin_token(self, guest):
        """Generate secure check-in token"""
        token_data = f"{str(self.event.id)}:{str(guest.id)}:{timezone.now().isoformat()}"
        token = secrets.token_urlsafe(32)
        
        # Cache token for validation
        cache_key = f"checkin_token:{self.event.id}:{guest.id}"
        cache.set(cache_key, token, timeout=86400 * 7)  # Valid for 7 days
        
        return token
    
    def validate_checkin(self, qr_payload):
        """Validate QR code payload for check-in"""
        try:
            decoded = base64.b64decode(qr_payload).decode()
            import json
            data = json.loads(decoded)
            
            event_id = data.get('event_id')
            guest_id = data.get('guest_id')
            token = data.get('token')
            
            if event_id != str(self.event.id):
                return False, "Invalid event"
            
            try:
                from .models import Guest
                guest = Guest.objects.get(id=guest_id, event=self.event)
            except Guest.DoesNotExist:
                return False, "Guest not found"
            
            # Validate token
            cache_key = f"checkin_token:{self.event.id}:{guest.id}"
            cached_token = cache.get(cache_key)
            
            if not cached_token or cached_token != token:
                return False, "Invalid or expired token"
            
            # Check if already checked in
            if guest.checked_in:
                return False, "Guest already checked in"
            
            return True, guest
            
        except Exception as e:
            return False, f"Invalid QR code: {str(e)}"
    
    def check_in_guest(self, guest):
        """Mark guest as checked in"""
        guest.checked_in = True
        guest.checked_in_at = timezone.now()
        guest.save()
        
        # Create check-in record
        from django.contrib.contenttypes.models import ContentType
        # Could log to audit trail here
        
        return guest
    
    def generate_bulk_qr_codes(self, guests, size=300):
        """Generate QR codes for multiple guests"""
        results = []
        
        for guest in guests:
            try:
                qr_data = self.generate_qr_code(guest, size)
                results.append({
                    'guest': guest,
                    'qr_code': qr_data['qr_code'],
                    'success': True
                })
            except Exception as e:
                results.append({
                    'guest': guest,
                    'error': str(e),
                    'success': False
                })
        
        return results
