import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { api } from '../shared/apiClient.js';

const server = new Server({ name: 'partyboard', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'list_stickies', description: 'List partyboard stickies for an event', inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, jwt: { type: 'string' } }, required: ['eventId'] } },
    { name: 'create_sticky', description: 'Create a sticky note', inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, text: { type: 'string' }, jwt: { type: 'string' } }, required: ['eventId', 'text'] } },
    { name: 'move_sticky', description: 'Update sticky position', inputSchema: { type: 'object', properties: { stickyId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, jwt: { type: 'string' } }, required: ['stickyId', 'x', 'y'] } },
    { name: 'vote_sticky', description: 'Vote on a sticky', inputSchema: { type: 'object', properties: { stickyId: { type: 'string' }, jwt: { type: 'string' } }, required: ['stickyId'] } },
    { name: 'list_tasks', description: 'List tasks derived from stickies', inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, jwt: { type: 'string' } }, required: ['eventId'] } },
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case 'list_stickies': {
        const { eventId, jwt } = z.object({ eventId: z.string(), jwt: z.string().optional() }).parse(args);
        const res = await api(`/api/partyboard/stickies/?event_id=${eventId}`, { jwt });
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'create_sticky': {
        const { eventId, text, jwt } = z.object({ eventId: z.string(), text: z.string(), jwt: z.string().optional() }).parse(args);
        const res = await api('/api/partyboard/stickies/', { method: 'POST', body: JSON.stringify({ event_id: eventId, text }), jwt });
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'move_sticky': {
        const { stickyId, x, y, jwt } = z.object({ stickyId: z.string(), x: z.number(), y: z.number(), jwt: z.string().optional() }).parse(args);
        const res = await api(`/api/partyboard/stickies/${stickyId}/position/`, { method: 'PATCH', body: JSON.stringify({ x, y }), jwt });
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'vote_sticky': {
        const { stickyId, jwt } = z.object({ stickyId: z.string(), jwt: z.string().optional() }).parse(args);
        const res = await api(`/api/partyboard/stickies/${stickyId}/vote/`, { method: 'POST', jwt });
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'list_tasks': {
        const { eventId, jwt } = z.object({ eventId: z.string(), jwt: z.string().optional() }).parse(args);
        const res = await api(`/api/partyboard/tasks/?event_id=${eventId}`, { jwt });
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  } catch (e: any) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
