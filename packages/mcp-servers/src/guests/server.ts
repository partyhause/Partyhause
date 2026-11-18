import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { api } from '../shared/apiClient.js';

const server = new Server({ name: 'guests', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'list_guests', description: 'List guests for event', inputSchema: { type: 'object', properties: { eventId: { type: 'string', format: 'uuid' } }, required: ['eventId'] } },
    { name: 'add_guest', description: 'Add guest', inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, email: { type: 'string', format: 'email' }, name: { type: 'string' } }, required: ['eventId','email'] } },
    { name: 'update_rsvp', description: 'Update RSVP status', inputSchema: { type: 'object', properties: { guestId: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['accepted','declined','tentative'] } }, required: ['guestId','status'] } },
    { name: 'check_in_guest', description: 'Check in guest', inputSchema: { type: 'object', properties: { guestId: { type: 'string', format: 'uuid' } }, required: ['guestId'] } }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    switch (name) {
      case 'list_guests': {
        const eventId = z.string().uuid().parse(args.eventId);
        const data = await api(`/guests/?event_id=${eventId}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      case 'add_guest': {
        const schema = z.object({ eventId: z.string().uuid(), email: z.string().email(), name: z.string().optional() });
        const p = schema.parse(args);
        const data = await api(`/guests/`, { method: 'POST', body: JSON.stringify(p) });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      case 'update_rsvp': {
        const schema = z.object({ guestId: z.string().uuid(), status: z.enum(['accepted','declined','tentative']) });
        const p = schema.parse(args);
        const data = await api(`/guests/${p.guestId}/rsvp/`, { method: 'PATCH', body: JSON.stringify({ status: p.status }) });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      case 'check_in_guest': {
        const guestId = z.string().uuid().parse(args.guestId);
        const data = await api(`/guests/${guestId}/check-in/`, { method: 'POST' });
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
