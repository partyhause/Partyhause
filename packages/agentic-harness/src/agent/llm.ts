/**
 * Minimal OpenAI-compatible chat completion client.
 *
 * Works against any provider exposing the OpenAI chat.completions shape
 * (OpenAI, NVIDIA NIM, Azure OpenAI, local Llama.cpp, etc.). Assembles the
 * assistant message for the agent loop.
 */

import type { AgentMessage } from './loop.js';
import type { McpTool } from '../mcp/protocol.js';

export interface LlmOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  seed?: number;
}

interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string | null; tool_calls?: unknown }>;
  tools?: Array<{ type: string; function: { name: string; description?: string; parameters: unknown } }>;
  tool_choice?: 'none' | 'required' | 'auto';
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  seed?: number;
  stream?: boolean;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { role: string; content: string | null; tool_calls?: unknown } }>;
}

/** Convert McpTool[] to OpenAI tools format. */
export function toOpenAITools(tools: McpTool[]): ChatCompletionRequest['tools'] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/** LLM-backed agent runtime. */
export class OpenAIRuntime {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly options: LlmOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    };
  }

  async complete(messages: AgentMessage[], tools: McpTool[]): Promise<AgentMessage> {
    const openaiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content ?? null,
      ...(m.toolCalls && m.toolCalls.length > 0
        ? {
            tool_calls: m.toolCalls.map((tc) => ({
              id: `${tc.name}-${Date.now()}`,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments },
            })),
          }
        : {}),
    }));

    const body: ChatCompletionRequest = {
      model: this.options.model,
      messages: openaiMessages,
      tools: toOpenAITools(tools),
      tool_choice: 'auto',
      temperature: this.options.temperature,
      top_p: this.options.topP,
      max_tokens: this.options.maxTokens,
      seed: this.options.seed,
      stream: false,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('LLM returned no message');

    const toolCalls = message.tool_calls
      ? (message.tool_calls as Array<{ function: { name: string; arguments: string } }>).map((tc) => ({
          name: tc.function.name,
          arguments: tc.function.arguments ?? '{}',
        }))
      : [];

    return {
      role: 'assistant',
      content: message.content ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}

export type { ChatCompletionResponse };
