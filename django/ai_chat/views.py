import os
import json
import re
from datetime import datetime

import httpx
from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.session_auth import SessionAuthMixin

from .models import AiUsage


# ---- Constants shared with the client contract ----
MAX_MESSAGES = 40
MAX_MESSAGE_CHARS = 4000
LLM_TIMEOUT_MS = 15_000
FREE_AI_TURNS = 3


# ---- LLM configuration ----
def _llm_config():
    """
    Return (endpoint, api_key, model, provider) for the active LLM.
    Priority: Azure OpenAI → OpenAI → NVIDIA → None.
    """
    # 1) Azure OpenAI
    endpoint = os.environ.get('AZURE_OPENAI_ENDPOINT', '').strip()
    api_key = os.environ.get('AZURE_OPENAI_API_KEY', '').strip()
    deployment = os.environ.get('AZURE_OPENAI_DEPLOYMENT', '').strip()
    if endpoint and api_key and deployment:
        return f'{endpoint.rstrip("/")}/openai/deployments/{deployment}/chat/completions', api_key, deployment, 'azure'

    # 2) OpenAI
    api_key = os.environ.get('OPENAI_API_KEY', '').strip()
    if api_key:
        model = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
        return 'https://api.openai.com/v1/chat/completions', api_key, model, 'openai'

    # 3) NVIDIA
    api_key = os.environ.get('NVIDIA_API_KEY', '').strip()
    if api_key:
        model = os.environ.get('NVIDIA_MODEL', 'nvidia/nemotron-3.5-lightning-30b-a3b')
        return 'https://integrate.api.nvidia.com/v1/chat/completions', api_key, model, 'nvidia'

    return None, None, None, None


# ---- Quota helpers ----
def _load_entitlement(user):
    """Reuse billing entitlement logic."""
    from billing.views import _load_facts, _compute_entitlement
    facts = _load_facts(user)
    billable = AiUsage.objects.filter(user=user, source='llm').count()
    return _compute_entitlement(facts, billable, datetime.now())


def _claim_turn(user, is_entitled):
    """
    Atomically claim one billable turn. Returns (granted, used_count).
    If entitled, always grants without counting against quota.
    """
    with transaction.atomic():
        current = AiUsage.objects.filter(user=user, source='llm').count()
        if is_entitled:
            return True, current
        if current >= FREE_AI_TURNS:
            return False, current
        AiUsage.objects.create(user=user, source='llm')
        return True, current + 1


def _settle_turn(user, source):
    """Adjust the claim after the model run: if heuristic, convert the provisional 'llm' row."""
    if source == 'heuristic':
        with transaction.atomic():
            row = AiUsage.objects.filter(user=user, source='llm').order_by('-created_at').first()
            if row:
                row.source = 'heuristic'
                row.save(update_fields=['source'])


# ---- Deterministic fallback (port from server/lib/event-chat.ts) ----
TEMPLATE_LABELS = {
    'birthday': 'birthday party',
    'kids-birthday': 'kids birthday party',
    'wedding': 'wedding',
    'conference': 'conference',
    'product-launch': 'product launch',
    'fundraiser': 'fundraiser',
    'festival': 'festival',
    'travel': 'group trip',
    'block-party': 'block party',
    'workshop': 'workshop',
    'hackathon': 'hackathon',
}

FIELD_PRIORITY = [
    ('eventDate', "When should the event happen? A rough date works."),
    ('expectedGuests', "About how many guests are you expecting?"),
    ('location', "Do you have a venue or location in mind?"),
    ('budget', "Is there a budget I should plan around?"),
]

FILLER_OPENINGS = re.compile(
    r'^(?:great(?:\s+question)?|awesome|amazing|perfect|sure(?:\s+thing)?'
    r'|absolutely|of course|no problem|got it|certainly|happy to help'
    r'|i\'d be happy to(?:\s+help(?:\s+with that)?)?|thanks?(?:\s+for\s+\w+)*'
    r'|thank you(?:\s+for\s+\w+)*)[,!.\s]+',
    re.IGNORECASE,
)


def _strip_filler(text):
    cleaned = text.strip()
    for _ in range(10):
        nxt = FILLER_OPENINGS.sub('', cleaned)
        if nxt == cleaned:
            break
        cleaned = nxt.strip()
    if cleaned:
        cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned


def _describe_known(extracted):
    parts = []
    if extracted.get('confidence', 0) > 0:
        tid = extracted.get('templateId')
        parts.append(f"a {TEMPLATE_LABELS.get(tid, tid)}")
    if extracted.get('eventDate'):
        parts.append(f"on {extracted['eventDate']}")
    if extracted.get('location'):
        parts.append(f"at {extracted['location']}")
    if extracted.get('expectedGuests'):
        parts.append(f"for ~{extracted['expectedGuests']} guests")
    if extracted.get('budget'):
        parts.append(f"with a ${extracted['budget']:,} budget")
    return ', '.join(parts) if parts else ''


def _next_missing(extracted):
    for key, question in FIELD_PRIORITY:
        if not extracted.get(key):
            return {'key': key, 'question': question}
    return None


def _is_core_complete(extracted):
    return bool(
        extracted.get('templateId')
        and extracted.get('confidence', 0) > 0
        and extracted.get('eventDate')
        and extracted.get('expectedGuests')
    )


def _run_fallback(messages):
    user_text = '\n'.join(m['content'] for m in messages if m['role'] == 'user')
    extracted = _extract_heuristically(user_text)
    complete = _is_core_complete(extracted)
    missing = _next_missing(extracted)
    known = _describe_known(extracted)

    last_user = next((m for m in reversed(messages) if m['role'] == 'user'), None)
    asked_open = last_user and last_user['content'].strip().endswith('?')

    sentences = []
    if asked_open:
        sentences.append(
            'The AI answer engine is not configured on this server, '
            'so I can only track event details, not answer open questions.'
        )
    if known:
        sentences.append(f"So far I have: {known}.")
    if missing and not complete:
        sentences.append(missing['question'])

    reply = ' '.join(sentences) if sentences else 'Tell me a bit about the event you have in mind.'
    return {
        'reply': reply,
        'extracted': extracted,
        'complete': complete,
        'source': 'heuristic',
    }


# ---- Heuristic extractor (minimal port) ----
def _extract_heuristically(text):
    """Very small deterministic extractor; see server/lib/event-extraction.ts for the full one."""
    import re
    from datetime import date

    result = {
        'templateId': None,
        'confidence': 0,
        'eventName': None,
        'eventDate': None,
        'eventTime': None,
        'expectedGuests': None,
        'location': None,
        'budget': None,
        'theme': None,
    }

    # template
    tpl = re.search(r'\b(birthday|wedding|conference|fundraiser|festival|hackathon|workshop|travel|block.party|product.launch)\b', text, re.I)
    if tpl:
        result['templateId'] = tpl.group(1).lower().replace(' ', '-')
        result['confidence'] = 1

    # date (ISO)
    iso = re.search(r'(\d{4}-\d{2}-\d{2})', text)
    if iso:
        result['eventDate'] = iso.group(1)

    # time
    tm = re.search(r'(\d{1,2}:\d{2}\s*(?:am|pm)?)', text, re.I)
    if tm:
        result['eventTime'] = tm.group(1)

    # guests
    g = re.search(r'(\d{1,3})\s*(?:guests?|people|attendees?)', text, re.I)
    if g:
        result['expectedGuests'] = int(g.group(1))

    # location
    loc = re.search(r'(?:at|in|venue\s+)\s+([A-Z][^,.\n]{2,})', text)
    if loc:
        result['location'] = loc.group(1).strip()

    # budget
    bud = re.search(r'\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:budget|max)', text, re.I)
    if bud:
        result['budget'] = float(bud.group(1).replace(',', ''))

    return result


# ---- LLM call ----
async def _call_llm(messages):
    endpoint, api_key, model, provider = _llm_config()
    if not endpoint:
        return None

    system = (
        "You are a concise event planner. Rules:\n"
        "1. Answer the user's actual question first.\n"
        "2. Carry no filler (no 'Great question!', 'Absolutely!', etc.).\n"
        "3. Ask at most ONE question per turn.\n"
        "4. Never re-ask for details already known.\n"
        "5. Return JSON: {reply, extracted, complete, source}.\n"
        "   extracted has: templateId, confidence, eventName, eventDate, eventTime,"
        "   expectedGuests, location, budget, theme.\n"
        "   complete=true when templateId, eventDate, and expectedGuests are known.\n"
    )

    payload = {
        'model': model,
        'messages': [{'role': 'system', 'content': system}] + messages,
        'temperature': 0.2,
        'max_tokens': 1500,
        'stream': False,
    }

    headers = {'Content-Type': 'application/json'}
    if provider == 'azure':
        headers['api-key'] = api_key
        endpoint += '?api-version=2024-02-15-preview'
    elif provider == 'openai':
        headers['Authorization'] = f'Bearer {api_key}'
    elif provider == 'nvidia':
        headers['Authorization'] = f'Bearer {api_key}'

    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT_MS / 1000) as client:
            resp = await client.post(endpoint, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            content = data['choices'][0]['message']['content']
            result = json.loads(content)
            result['reply'] = _strip_filler(result.get('reply', ''))
            return result
    except Exception:
        return None


# ---- Views ----
class ChatView(SessionAuthMixin, APIView):
    """POST /api/ai/chat — one conversational turn."""

    def post(self, request):
        messages = request.data.get('messages', [])
        if not isinstance(messages, list) or not messages:
            return Response(
                {'error': f'Provide {{ messages: [{{role, content}}...] }} - 1..{MAX_MESSAGES} entries, last one from the user'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Sanitize and trim
        sanitized = []
        for m in messages[-(MAX_MESSAGES):]:
            role = m.get('role')
            content = m.get('content', '')
            if role in ('user', 'assistant') and isinstance(content, str):
                sanitized.append({'role': role, 'content': content[:MAX_MESSAGE_CHARS]})
        if not sanitized or sanitized[-1]['role'] != 'user':
            return Response(
                {'error': 'The last message must be from the user'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Entitlement & quota claim
        entitlement = _load_entitlement(request.user)
        is_entitled = entitlement.get('is_entitled', False)

        granted, used = _claim_turn(request.user, is_entitled)
        if not granted:
            ai = entitlement.get('ai', {})
            return Response(
                {
                    'error': 'Your free turns are used up.',
                    'code': 'PAYMENT_REQUIRED',
                    'paywall': entitlement.get('paywall'),
                    'ai': {**ai, 'used': used, 'remaining': 0},
                },
                status=402,
            )

        # Run turn
        try:
            result = None
            import asyncio
            try:
                result = asyncio.run(_call_llm(sanitized))
            except RuntimeError:
                # Already in event loop (e.g. gunicorn with uvicorn workers)
                import nest_asyncio
                nest_asyncio.apply()
                result = asyncio.run(_call_llm(sanitized))

            if result is None:
                result = _run_fallback(sanitized)

            _settle_turn(request.user, result.get('source', 'heuristic'))

            return Response({'success': True, 'data': result})

        except Exception as e:
            _settle_turn(request.user, 'failed')
            return Response({'error': f'Chat turn failed: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class BoardActionView(SessionAuthMixin, APIView):
    """POST /api/ai/board-action — create a sticky/task from AI proposal."""

    def post(self, request):
        event_id = request.data.get('event_id') or request.data.get('eventId')
        action = request.data.get('action')
        data = request.data.get('data', {})
        if not event_id or action not in ('create_sticky', 'create_task'):
            return Response(
                {'error': 'event_id and action (create_sticky|create_task) required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from events.models import Event
        from events.views import EventAccess
        event = Event.objects.filter(id=event_id).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        access = EventAccess(event, request.user)
        if not access.can_edit():
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        if action == 'create_sticky':
            from partyboard.models import PartyBoardSticky
            sticky = PartyBoardSticky.objects.create(
                event=event,
                type='note',
                position_x=data.get('position_x', 0),
                position_y=data.get('position_y', 0),
                width=data.get('width', 200),
                height=data.get('height', 200),
                data=data.get('data', {}),
                creator=request.user,
            )
            return Response({'sticky': {'id': str(sticky.id), 'event_id': str(event_id)}})

        # create_task
        from partyboard.models import PartyBoardSticky, PartyBoardTask
        sticky_id = data.get('sticky_id')
        if not sticky_id:
            return Response({'error': 'sticky_id required for create_task'}, status=status.HTTP_400_BAD_REQUEST)
        sticky = PartyBoardSticky.objects.filter(id=sticky_id, event=event).first()
        if not sticky:
            return Response({'error': 'Sticky not found'}, status=status.HTTP_404_NOT_FOUND)

        task, _ = PartyBoardTask.objects.get_or_create(
            sticky=sticky,
            defaults={
                'event': event,
                'title': data.get('title') or f'Task from sticky {sticky_id}',
                'description': data.get('description'),
                'assignee': request.user,
                'priority': data.get('priority', 'medium'),
                'status': 'open',
                'created_by': request.user,
            },
        )
        return Response({'task_id': str(task.id), 'status': 'created', 'task': {'id': str(task.id)}})