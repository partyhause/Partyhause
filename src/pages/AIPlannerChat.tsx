import { useState, useRef, useEffect } from 'react';
import { usePartyStore } from '@/store/usePartyStore';
import { PageShell, useBackToDashboard } from '@/components/layout/PageShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Sparkles } from 'lucide-react';

const NVIDIA_MODELS = [
  { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b', name: 'Nemotron 3.5 Super VL' },
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', name: 'Nemotron 3.5 Lightning' },
];

export default function AIPlannerChat() {
  const user = usePartyStore(s => s.user);
  const handleBack = useBackToDashboard();
  const [messages, setMessages] = useState<{role: 'user'|'assistant', content: string}[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(NVIDIA_MODELS[1].id);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, model })
      });
      if (!res.ok) throw new Error('Request failed');
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream');
      
      let assistantContent = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const delta = data.choices?.[0]?.delta?.content || '';
              assistantContent += delta;
              setMessages([...newMessages, { role: 'assistant', content: assistantContent }]);
            } catch {}
          }
        }
      }
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: 'Error contacting AI service' }]);
    }
    setLoading(false);
  };

  return (
    <PageShell title="AI Event Planner" maxWidth="md" onBack={handleBack}>
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <select aria-label="Model selector" value={model} onChange={e => setModel(e.target.value)} className="border rounded p-1">
              {NVIDIA_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="h-96 overflow-y-auto space-y-2 border rounded p-2">
            {messages.map((m, i) => (
              <div key={i} className={`p-2 rounded ${m.role === 'user' ? 'bg-muted' : 'bg-orange-50'}`} role="log" aria-live="polite">
                <p className="text-sm whitespace-pre-wrap">{m.content}</p>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="flex gap-2">
            <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask AI planner..." onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()} maxLength={2000} />
            <Button onClick={sendMessage} disabled={loading}>
              {loading ? '...' : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
