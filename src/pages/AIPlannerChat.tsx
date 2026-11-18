import { useState } from 'react';
import { usePartyStore } from '@/store/usePartyStore';
import { PageShell, useBackToDashboard } from '@/components/layout/PageShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send } from 'lucide-react';

const NVIDIA_MODELS = [
  { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b', name: 'Nemotron 3.5 Super VL' },
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', name: 'Nemotron 3.5 Lightning' },
  { id: 'nvidia/nemotron-3.5-embed-1b', name: 'Nemotron 3.5 Embed' },
];

export default function AIPlannerChat() {
  const user = usePartyStore(s => s.user);
  const handleBack = useBackToDashboard();
  const [messages, setMessages] = useState<{role: 'user'|'assistant', content: string}[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(NVIDIA_MODELS[1].id);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const newMessages = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');
    setMessages([...newMessages, { role: 'assistant', content: `Planning with PartyHause tools using ${model}...` }]);
  };

  return (
    <PageShell title="AI Event Planner" maxWidth="md" onBack={handleBack}>
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="mb-2">
            <select value={model} onChange={e => setModel(e.target.value)} className="border rounded p-1">
              {NVIDIA_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="h-96 overflow-y-auto space-y-2">
            {messages.map((m, i) => (
              <div key={i} className={`p-2 rounded ${m.role === 'user' ? 'bg-muted' : 'bg-orange-50'}`}>
                <p className="text-sm">{m.content}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask AI planner..." />
            <Button onClick={sendMessage}><Send className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
