import os
import requests
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from accounts.session_auth import SessionAuthMixin, _SessionAuthStop

class ChatView(SessionAuthMixin, APIView):
    REQUIRES_VERIFIED = True

    def post(self, request):
        try:
            self._verify_token()
        except _SessionAuthStop as e:
            return e.args[0]
        
        messages = request.data.get('messages', [])
        model = request.data.get('model', 'nvidia/nemotron-3.5-lightning-30b-a3b')
        
        api_key = os.environ.get('NVIDIA_API_KEY')
        if not api_key:
            return Response({'error': 'NVIDIA API key not configured'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'model': model,
            'messages': messages,
            'temperature': 1,
            'top_p': 0.95,
            'max_tokens': 16384,
            'stream': False,
            'seed': 42,
            'extra_body': {
                'chat_template_kwargs': {'enable_thinking': True}
            }
        }
        
        try:
            resp = requests.post(
                'https://integrate.api.nvidia.com/v1/chat/completions',
                json=payload,
                headers=headers,
                timeout=60
            )
            resp.raise_for_status()
            return Response(resp.json())
        except requests.RequestException as e:
            return Response({'error': str(e)}, status=status.HTTP_502_BAD_GATEWAY)
