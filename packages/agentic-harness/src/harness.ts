/**
 * Agentic harness.
 *
 * Owns a registry of MCP clients (stdio + SSE), discovers their tools, and runs
 * the agent loop against an LLM. The harness itself never speaks directly to a
 * tool — it routes every call through the matching MCP client.
 */

import type { McpTransport } from './mcp/transport.js';
import { StdioMcpTransport } from './mcp/stdio.js';
import { SseMcpTransport } from './mcp/sse.js';
import type { CallToolParams, McpTool } from './mcp/protocol.js';
import { initialize } from './mcp/client.js';
import { OpenAIRuntime } from './agent/llm.js';
import type { AgentMessage, AgentRuntime, AgentTurnResult } from './agent/loop.js';
import { runAgentLoop } from './agent/loop.js';

export interface HarnessOptions {
  /** LLM provider options. */
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    seed?: number;
  };
  /** MCP clients to connect. */
  clients: Record<string, McpClientConfig>;
  /** Agent loop options. */
  loop?: { maxSteps?: number; echoToolResults?: boolean };
}

export interface McpClientConfig {
  /** Stdio server: command + args. */
  stdio?: { command: string; args?: string[]; env?: Record<string, string> };
  /** SSE server: base URL. */
  sse?: { baseUrl: string; headers?: Record<string, string> };
  /** Human name used to attribute tools. Defaults to the transport kind. */
  name?: string;
}

/** One connected MCP client with its discovered tools. */
interface ConnectedClient {
  transport: McpTransport;
  tools: McpTool[];
}

/** The harness: connect clients, run agents, shut down cleanly. */
export class Harness implements AgentRuntime {
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly options: Required<HarnessOptions>;
  private llm: OpenAIRuntime | null = null;

  constructor(options: HarnessOptions) {
    this.options = {
      llm: {
        baseUrl: options.llm.baseUrl,
        apiKey: options.llm.apiKey,
        model: options.llm.model,
        temperature: options.llm.temperature ?? 1,
        topP: options.llm.topP ?? 0.95,
        maxTokens: options.llm.maxTokens ?? 16384,
        seed: options.llm.seed ?? 42,
      },
      clients: options.clients,
      loop: { maxSteps: options.loop?.maxSteps ?? 10, echoToolResults: options.loop?.echoToolResults ?? true },
    };
  }

  /** Connect to every configured MCP client and discover their tools. */
  async connect(): Promise<void> {
    const entries = Object.entries(this.options.clients);
    await Promise.all(
      entries.map(async ([key, cfg]: [string, McpClientConfig]) => {
        let transport: McpTransport;
        let name = cfg.name ?? key;

        if (cfg.stdio) {
          transport = StdioMcpTransport.create(cfg.stdio.command, cfg.stdio.args, cfg.stdio.env);
          name = cfg.name ?? `stdio:${cfg.stdio.command}`;
        } else if (cfg.sse) {
          transport = SseMcpTransport.create(cfg.sse.baseUrl, cfg.sse.headers);
          name = cfg.name ?? `sse:${cfg.sse.baseUrl}`;
        } else {
          throw new Error(`MCP client '${key}' must specify stdio or sse`);
        }

        await transport.connect();
        const initialized = await initialize(transport);
        const tools = initialized.tools.map((t) => ({ ...t, server: name }));

        this.clients.set(key, { transport, tools });
      })
    );
  }

  /** All discovered tools across all connected clients, with server attribution. */
  get tools(): McpTool[] {
    return [...this.clients.values()].flatMap((c) => c.tools);
  }

  /** Execute a tool call routed to the right MCP client by server name. */
  async callTool(_server: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    // Find the client that owns this tool.
    for (const client of this.clients.values()) {
      const tool = client.tools.find((t) => t.name === name);
      if (!tool) continue;
      const result = await client.transport.request<{
        content: Array<{ type: string; text?: string }>;
        isError?: boolean;
      }>({
        jsonrpc: '2.0',
        id: String(Date.now()),
        method: 'tools/call',
        params: { name, arguments: args } as CallToolParams,
      });
      return result.content?.map((c) => c.text ?? c).join('\n') ?? result;
    }
    throw new Error(`Tool '${name}' not found on any connected MCP client`);
  }

  /** Ask the LLM for the next assistant message given the conversation. */
  async complete(messages: AgentMessage[], tools: McpTool[]): Promise<AgentMessage> {
    if (!this.llm) {
      this.llm = new OpenAIRuntime(this.options.llm);
    }
    return this.llm.complete(messages, tools);
  }

  /** Run one agent turn: LLM decides tools, harness executes them via MCP. */
  async run(messages: AgentMessage[], options?: { maxSteps?: number }): Promise<AgentTurnResult> {
    return runAgentLoop(this, messages, this.tools, { ...this.options.loop, ...options });
  }

  /** One-shot: system + user, run to completion, return final answer. */
  async ask(system: string, user: string, options?: { maxSteps?: number }): Promise<string> {
    const result = await this.run(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options
    );
    if (!result.finished || !result.finalAnswer) {
      throw new Error('Agent did not produce a final answer');
    }
    return result.finalAnswer;
  }

  /** Close every MCP transport. */
  async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.transport.close()));
    this.clients.clear();
  }
}
