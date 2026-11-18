import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { api } from '../shared/apiClient.js';

const server = new Server({ name: 'timeline', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'list_timeline', description: 'List timeline blocks for an event', inputSchema: { type: 'object', properties: { eventId: { type: 'string' } }, required: ['eventId'] } },
    { name: 'create_block', description: 'Create a timeline block', inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }, required: ['eventId', 'title', 'start', 'end'] } },
    { name: 'update_block', description: 'Update a timeline block', inputSchema: { type: 'object', properties: { blockId: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }, required: ['blockId'] } },
    { name: 'delete_block', description: 'Delete a timeline block', inputSchema: { type: 'object', properties: { blockId: { type: 'string' } }, required: ['blockId'] } },
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case 'list_timeline': {
        const { eventId } = z.object({ eventId: z.string() }).parse(args);
        const res = await api(`/api/events/${eventId}/timeline/`);
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'create_block': {
        const { eventId, title, start, end } = z.object({ eventId: z.string(), title: z.string(), start: z.string(), end: z.string() }).parse(args);
        const res = await api('/api/timeline/', { method: 'POST', body: JSON.stringify({ event_id: eventId, title, start, end }) });
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'update_block': {
        const { blockId, title, start, end } = z.object({ blockId: z.string(), title: z.string().optional(), start: z.string().optional(), end: z.string().optional() }).parse(args);
        const body: any = {};
        if (title) body.title = title;
        if (start) body.start = start;
        if (end) body.end = end;
        const res = await api(`/api/timeline/${blockId}/`, { method: 'PUT', body: JSON.stringify(body) });
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'delete_block': {
        const { blockId } = z.object({ blockId: z.string() }).parse(args);
        const res = await api(`/api/timeline/${blockId}/`, { method: 'DELETE' });
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
