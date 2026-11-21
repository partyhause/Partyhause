/**
 * MCP client handshake.
 *
 * Performs the JSON-RPC `initialize` handshake against a connected transport
 * and lists its tools. One call per transport after `connect()`.
 */

import type { McpTransport } from './transport.js';
import type { InitializeParams, InitializeResult, McpError } from './protocol.js';

/** Result of initializing an MCP client. */
export interface McpClientInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version?: string };
  tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
}

/**
 * Initialize an MCP session and list available tools.
 *
 * Sends `initialize`, then `initialized` notification, then `tools/list`.
 */
export async function initialize(
  transport: McpTransport,
  clientInfo?: { name: string; version?: string }
): Promise<McpClientInitializeResult> {
  const info: { name: string; version?: string } =
    clientInfo ?? { name: '@partyhause/agentic-harness', version: '0.1.0' };
  const params: InitializeParams = {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: info,
  };

  const result = (await transport.request<InitializeResult>({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params,
  })) as InitializeResult;

  // Notify the server the client is initialized (no response expected).
  await transport.notify({
    jsonrpc: '2.0',
    method: 'initialized',
  });

  const listed = (await transport.request({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  })) as { tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }> };

  return {
    protocolVersion: result.protocolVersion,
    capabilities: result.capabilities,
    serverInfo: { name: result.serverInfo.name, version: result.serverInfo.version ?? undefined },
    tools: listed.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

export type { McpError };
