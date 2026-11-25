import os
import asyncio
import json
from django.http import StreamingHttpResponse, JsonResponse
from django.views import View
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

@method_decorator(csrf_exempt, name='dispatch')
class ChatStreamView(SessionAuthMixin, View):
    REQUIRES_VERIFIED = True

    async def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            resp = e.args[0]
            # Convert DRF Response to Django JsonResponse
            if hasattr(resp, 'data'):
                return JsonResponse(resp.data, status=resp.status_code)
            return JsonResponse({'error': str(resp)}, status=500)

        try:
            body = json.loads(request.body.decode() or '{}')
        except Exception:
            return JsonResponse({'error': 'invalid json'}, status=400)

        messages = body.get('messages', [])
        model = body.get('model', 'nvidia/nemotron-3.5-lightning-30b-a3b')

        api_key = os.environ.get('NVIDIA_API_KEY')
        if not api_key:
            return JsonResponse({'error': 'NVIDIA API key not configured'}, status=500)

        async def event_stream():
            import httpx
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            }
            payload = {
                'model': model,
                'messages': messages,
                'temperature': 1,
                'top_p': 0.95,
                'max_tokens': 16384,
                'stream': True,
                'seed': 42,
                'extra_body': {'chat_template_kwargs': {'enable_thinking': True}}
            }
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream('POST', 'https://integrate.api.nvidia.com/v1/chat/completions', json=payload, headers=headers) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith('data:'):
                            data = line[5:].strip()
                            if data == '[DONE]':
                                break
                            try:
                                chunk = json.loads(data)
                                yield f"data: {json.dumps(chunk)}\n\n"
                            except:
                                pass

        response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
        response['Cache-Control'] = 'no-cache'
        response['X-Accel-Buffering'] = 'no'
        return response
