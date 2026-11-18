import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { api } from '../shared/apiClient.js';

const server = new Server({ name: 'invites', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'list_invites', description: 'List invites for event', inputSchema: { type: 'object', properties: { eventId: { type: 'string', format: 'uuid' } }, required: ['eventId'] } },
    { name: 'create_invite', description: 'Create invite', inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, email: { type: 'string', format: 'email' }, name: { type: 'string' } }, required: ['eventId','email'] } },
    { name: 'send_invite', description: 'Send invite email', inputSchema: { type: 'object', properties: { inviteId: { type: 'string', format: 'uuid' } }, required: ['inviteId'] } },
    { name: 'revoke_invite', description: 'Revoke invite', inputSchema: { type: 'object', properties: { inviteId: { type: 'string', format: 'uuid' } }, required: ['inviteId'] } }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    switch (name) {
      case 'list_invites': {
        const eventId = z.string().uuid().parse(args.eventId);
        const data = await api(`/invites/?event_id=${eventId}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      case 'create_invite': {
        const schema = z.object({ eventId: z.string().uuid(), email: z.string().email(), name: z.string().optional() });
        const p = schema.parse(args);
        const data = await api(`/invites/`, { method: 'POST', body: JSON.stringify(p) });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      case 'send_invite': {
        const inviteId = z.string().uuid().parse(args.inviteId);
        const data = await api(`/invites/${inviteId}/send/`, { method: 'POST' });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      case 'revoke_invite': {
        const inviteId = z.string().uuid().parse(args.inviteId);
        await api(`/invites/${inviteId}/`, { method: 'DELETE' });
        return { content: [{ type: 'text', text: 'revoked' }] };
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
