/**
 * Model Context Protocol (MCP) protocol types.
 *
 * A thin, dependency-free JSON-RPC surface describing the messages the harness
 * can send to and receive from an MCP server. Intentional surface only:
 * initialize, tools/list, tools/call. Resources and prompts are out of scope
 * for this small harness.
 */

import { z } from 'zod';

/** JSON-RPC 2.0 message envelope schemas. */
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

export const JsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;
export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;

/** An in-flight request awaiting a response. */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** MCP Initialize request params and result. */
export const InitializeParamsSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.unknown()).optional(),
  clientInfo: z.object({ name: z.string(), version: z.string().optional() }).optional(),
});

export const InitializeResultSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.unknown()),
  serverInfo: z.object({ name: z.string(), version: z.string().optional() }),
});

export type InitializeParams = z.infer<typeof InitializeParamsSchema>;
export type InitializeResult = z.infer<typeof InitializeResultSchema>;

/** tools/list request + response. */
export const ListToolsResultSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      inputSchema: z.record(z.unknown()),
    })
  ),
});

export type ListToolsResult = z.infer<typeof ListToolsResultSchema>;

/** tools/call params + response. */
export const CallToolParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).optional(),
});

export const CallToolResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    })
  ),
  isError: z.boolean().optional(),
});

export type CallToolParams = z.infer<typeof CallToolParamsSchema>;
export type CallToolResult = z.infer<typeof CallToolResultSchema>;

/** MCP capability flags the client advertises. */
export const ClientCapabilitiesSchema = z.object({
  roots: z
    .object({ listChanged: z.boolean().optional() })
    .optional(),
  sampling: z.optional(z.unknown()),
});

export type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>;

/** A discovered MCP tool, normalized for the agent loop. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  server: string;
}

/** MCP server connection state. */
export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Error thrown when an MCP call fails. */
export class McpError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
    this.name = 'McpError';
  }
}

/** Error thrown when a transport is closed mid-request. */
export class TransportClosedError extends Error {
  constructor() {
    super('Transport closed');
    this.name = 'TransportClosedError';
  }
}
