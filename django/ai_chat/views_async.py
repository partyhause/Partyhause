import os
import asyncio
import json
from django.http import StreamingHttpResponse
from asgiref.sync import sync_to_async
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

class ChatStreamView(SessionAuthMixin):
    REQUIRES_VERIFIED = True

    async def post(self, request):
        # Verify auth sync
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        
        messages = request.data.get('messages', [])
        model = request.data.get('model', 'nvidia/nemotron-3.5-lightning-30b-a3b')
        
        api_key = os.environ.get('NVIDIA_API_KEY')
        if not api_key:
            return StreamingHttpResponse(b'error', status=500)
        
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
