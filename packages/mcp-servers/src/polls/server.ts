import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { api } from '../shared/apiClient.js';

const server = new Server({ name: 'polls', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'list_polls', description: 'List polls for event', inputSchema: { type: 'object', properties: { eventId: { type: 'string', format: 'uuid' } }, required: ['eventId'] } },
    { name: 'create_poll', description: 'Create poll', inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['eventId','question','options'] } },
    { name: 'vote_poll', description: 'Vote in poll', inputSchema: { type: 'object', properties: { pollId: { type: 'string', format: 'uuid' }, optionId: { type: 'string' }, userId: { type: 'string' } }, required: ['pollId','optionId','userId'] } },
    { name: 'close_poll', description: 'Close poll', inputSchema: { type: 'object', properties: { pollId: { type: 'string', format: 'uuid' } }, required: ['pollId'] } }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    switch (name) {
      case 'list_polls': {
        const eventId = z.string().uuid().parse(args.eventId);
        const data = await api(`/polls/?event_id=${eventId}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      case 'create_poll': {
        const schema = z.object({ eventId: z.string().uuid(), question: z.string(), options: z.array(z.string()).min(2) });
        const p = schema.parse(args);
        const data = await api(`/polls/`, { method: 'POST', body: JSON.stringify(p) });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      case 'vote_poll': {
        const schema = z.object({ pollId: z.string().uuid(), optionId: z.string().uuid(), userId: z.string().uuid() });
        const p = schema.parse(args);
        const data = await api(`/polls/${p.pollId}/vote/`, { method: 'POST', body: JSON.stringify({ option_id: p.optionId, user_id: p.userId }) });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      case 'close_poll': {
        const pollId = z.string().uuid().parse(args.pollId);
        const data = await api(`/polls/${pollId}/close/`, { method: 'POST' });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      default: throw new Error(`Unknown tool ${name}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
