"""
Tests for SlashTolerantMiddleware.

Verifies that API endpoints accept both trailing-slash and non-trailing-slash
requests without losing POST data.
"""
from django.test import RequestFactory, override_settings, SimpleTestCase
from django.urls import path
from django.http import JsonResponse
from partyhause.middleware import SlashTolerantMiddleware


def dummy_view(request):
    return JsonResponse({'ok': True})


urlpatterns = [
    path('api/test-endpoint/', dummy_view, name='test_endpoint'),
]


class SlashTolerantMiddlewareTests(SimpleTestCase):
    @override_settings(ROOT_URLCONF='tests.test_slash_tolerant', DEBUG=True, APPEND_SLASH=True)
    def test_slash_tolerant_post_without_slash(self):
        factory = RequestFactory()
        request = factory.post('/api/test-endpoint', data={}, content_type='application/json')
        middleware = SlashTolerantMiddleware(lambda r: dummy_view(r))
        middleware(request)
        self.assertEqual(request.path, '/api/test-endpoint/')

    @override_settings(ROOT_URLCONF='tests.test_slash_tolerant', DEBUG=True, APPEND_SLASH=True)
    def test_slash_tolerant_get_without_slash(self):
        factory = RequestFactory()
        request = factory.get('/api/test-endpoint')
        middleware = SlashTolerantMiddleware(lambda r: dummy_view(r))
        middleware(request)
        # GET is left untouched; CommonMiddleware will 301 if needed
        self.assertEqual(request.path, '/api/test-endpoint')

    @override_settings(ROOT_URLCONF='tests.test_slash_tolerant', DEBUG=True, APPEND_SLASH=True)
    def test_slash_tolerant_put_without_slash(self):
        factory = RequestFactory()
        request = factory.put('/api/test-endpoint', data=b'{}', content_type='application/json')
        middleware = SlashTolerantMiddleware(lambda r: dummy_view(r))
        middleware(request)
        self.assertEqual(request.path, '/api/test-endpoint/')

    def test_slash_tolerant_no_rewrite_for_non_api(self):
        factory = RequestFactory()
        request = factory.post('/admin/login')
        middleware = SlashTolerantMiddleware(lambda r: dummy_view(r))
        middleware(request)
        # Non-API paths are not rewritten
        self.assertEqual(request.path, '/admin/login')

    def test_slash_tolerant_invalid_path_unchanged(self):
        factory = RequestFactory()
        request = factory.post('/api/does-not-exist', data={}, content_type='application/json')
        middleware = SlashTolerantMiddleware(lambda r: JsonResponse({'error': 'not found'}, status=404))
        middleware(request)
        # Resolve will raise Http404, path remains unchanged
        self.assertEqual(request.path, '/api/does-not-exist')
