from django.core.cache import cache
from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin
import time

class RateLimitMiddleware(MiddlewareMixin):
    def __init__(self, get_response):
        self.get_response = get_response
        self.limits = {
            'default': {'requests': 100, 'window': 60},
            'auth': {'requests': 5, 'window': 60},
            'api': {'requests': 1000, 'window': 3600},
        }
    
    def __call__(self, request):
        # Skip rate limiting for health checks
        if request.path in ['/health/', '/admin/']:
            return self.get_response(request)
        
        # Determine rate limit based on endpoint
        limit_config = self.limits['default']
        if '/api/auth/' in request.path:
            limit_config = self.limits['auth']
        elif '/api/' in request.path:
            limit_config = self.limits['api']
        
        # Get client identifier
        client_id = self.get_client_id(request)
        cache_key = f"ratelimit:{client_id}:{request.path}"
        
        # Get current request count
        request_data = cache.get(cache_key, {'count': 0, 'reset_time': time.time() + limit_config['window']})
        
        # Reset if window expired
        if time.time() > request_data['reset_time']:
            request_data = {'count': 0, 'reset_time': time.time() + limit_config['window']}
        
        # Check limit
        if request_data['count'] >= limit_config['requests']:
            return JsonResponse({
                'error': 'Rate limit exceeded',
                'retry_after': int(request_data['reset_time'] - time.time())
            }, status=429)
        
        # Increment count
        request_data['count'] += 1
        cache.set(cache_key, request_data, timeout=limit_config['window'])
        
        return self.get_response(request)
    
    def get_client_id(self, request):
        # Use IP + User Agent for identification
        ip = request.META.get('HTTP_X_FORWARDED_FOR', request.META.get('REMOTE_ADDR'))
        user_agent = request.META.get('HTTP_USER_AGENT', '')
        return f"{ip}:{hash(user_agent) % 10000}"
