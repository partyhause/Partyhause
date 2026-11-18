import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { api } from '../shared/apiClient.js';

const server = new Server({ name: 'liveday', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'get_live_day_summary', description: 'Get live day summary for an event', inputSchema: { type: 'object', properties: { eventId: { type: 'string' } }, required: ['eventId'] } },
    { name: 'check_in_guest', description: 'Check in a guest', inputSchema: { type: 'object', properties: { guestId: { type: 'string' } }, required: ['guestId'] } },
    { name: 'list_check_ins', description: 'List check-ins for an event', inputSchema: { type: 'object', properties: { eventId: { type: 'string' } }, required: ['eventId'] } },
    { name: 'push_notification', description: 'Push a live notification', inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, message: { type: 'string' } }, required: ['eventId', 'message'] } },
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case 'get_live_day_summary': {
        const { eventId } = z.object({ eventId: z.string() }).parse(args);
        const res = await api(`/api/events/${eventId}/live/`);
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'check_in_guest': {
        const { guestId } = z.object({ guestId: z.string() }).parse(args);
        const res = await api(`/api/guests/${guestId}/check-in/`, { method: 'POST' });
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'list_check_ins': {
        const { eventId } = z.object({ eventId: z.string() }).parse(args);
        const res = await api(`/api/events/${eventId}/guests/?check_in=true`);
        return { content: [{ type: 'text', text: await res.text() }] };
      }
      case 'push_notification': {
        const { eventId, message } = z.object({ eventId: z.string(), message: z.string() }).parse(args);
        const res = await api('/api/notifications/', { method: 'POST', body: JSON.stringify({ event_id: eventId, message }) });
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
