import re
from django.core.exceptions import ValidationError
from django.utils.html import strip_tags

class InputValidator:
    """Centralized input validation and sanitization"""
    
    EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
    URL_REGEX = re.compile(
        r'^https?://'  # http:// or https://
        r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'  # domain
        r'localhost|'  # localhost
        r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'  # IP
        r'(?::\d+)?'  # optional port
        r'(?:/?|[/?]\S+)$', re.IGNORECASE
    )
    
    @staticmethod
    def sanitize_string(value, max_length=1000):
        """Sanitize string input"""
        if not isinstance(value, str):
            raise ValidationError('Value must be a string')
        
        # Strip HTML tags
        sanitized = strip_tags(value)
        
        # Remove control characters
        sanitized = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', sanitized)
        
        # Trim whitespace
        sanitized = sanitized.strip()
        
        # Check length
        if len(sanitized) > max_length:
            raise ValidationError(f'String too long (max {max_length} characters)')
        
        return sanitized
    
    @staticmethod
    def validate_email(email):
        """Validate email address"""
        if not InputValidator.EMAIL_REGEX.match(email):
            raise ValidationError('Invalid email address')
        return email.lower().strip()
    
    @staticmethod
    def validate_url(url):
        """Validate URL"""
        if not InputValidator.URL_REGEX.match(url):
            raise ValidationError('Invalid URL')
        return url.strip()
    
    @staticmethod
    def validate_uuid(uuid_str):
        """Validate UUID format"""
        import uuid
        try:
            uuid.UUID(str(uuid_str))
            return str(uuid_str)
        except ValueError:
            raise ValidationError('Invalid UUID format')
    
    @staticmethod
    def validate_choice(value, choices):
        """Validate value is in choices"""
        if value not in choices:
            raise ValidationError(f'Invalid choice. Must be one of: {", ".join(choices)}')
        return value
    
    @staticmethod
    def validate_date_range(start_date, end_date):
        """Validate date range"""
        if start_date >= end_date:
            raise ValidationError('End date must be after start date')
        return True
    
    @staticmethod
    def validate_positive_number(value, field_name='value'):
        """Validate positive number"""
        if value <= 0:
            raise ValidationError(f'{field_name} must be positive')
        return value
    
    @staticmethod
    def sanitize_json(data):
        """Recursively sanitize JSON data"""
        if isinstance(data, dict):
            return {k: InputValidator.sanitize_json(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [InputValidator.sanitize_json(item) for item in data]
        elif isinstance(data, str):
            return InputValidator.sanitize_string(data)
        else:
            return data
