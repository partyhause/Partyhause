/**
 * Agent loop types.
 *
 * The agent orchestrates an LLM against a set of MCP-connected tools. It
 * decides which tool to call, executes it, feeds the result back, and repeats
 * until the LLM produces a final answer or the step budget is exhausted.
 */

import type { McpTool } from '../mcp/protocol.js';
/** A single turn in the conversation. */
export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  /** Tool calls the assistant requested in this message. */
  toolCalls?: Array<{ name: string; arguments: string }>;
  /** Tool call results being returned to the assistant. */
  toolResults?: Array<{ name: string; result: unknown }>;
}

/** Result of one agent turn. */
export interface AgentTurnResult {
  messages: AgentMessage[];
  finished: boolean;
  finalAnswer?: string;
  toolCallsMade: number;
}

/** Capabilities the agent runtime must provide. */
export interface AgentRuntime {
  /** Ask the LLM for the next assistant message given the conversation. */
  complete(messages: AgentMessage[], tools: McpTool[]): Promise<AgentMessage>;
  /** Execute a discovered MCP tool on a named server. */
  callTool(server: string, name: string, arguments_: Record<string, unknown>): Promise<unknown>;
}

/** Budget and behavior knobs for the loop. */
export interface AgentLoopOptions {
  /** Maximum tool-calling steps before forcing a final answer. Default 10. */
  maxSteps?: number;
  /** Whether to append tool results as assistant-visible messages. Default true. */
  echoToolResults?: boolean;
}

const DEFAULT_MAX_STEPS = 10;

/**
 * Run a simple ReAct-style agent loop:
 *
 *   1. LLM is given the conversation + available tools
 *   2. If it requests tool calls, execute each and append results
 *   3. Repeat until the LLM emits plain text (final answer) or steps run out
 */
export async function runAgentLoop(
  runtime: AgentRuntime,
  initialMessages: AgentMessage[],
  tools: McpTool[],
  options: AgentLoopOptions = {}
): Promise<AgentTurnResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const echoToolResults = options.echoToolResults ?? true;
  const messages = [...initialMessages];
  let toolCallsMade = 0;

  for (let step = 0; step < maxSteps; step++) {
    const assistant = await runtime.complete(messages, tools);

    if (!assistant.toolCalls || assistant.toolCalls.length === 0) {
      // No tool call: this is the final answer.
      return {
        messages: [...messages, assistant],
        finished: true,
        finalAnswer: assistant.content,
        toolCallsMade,
      };
    }

    messages.push(assistant);
    toolCallsMade += assistant.toolCalls.length;

    // Execute every requested tool call, in order.
    for (const call of assistant.toolCalls) {
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(call.arguments);
      } catch (err) {
        const errorResult = {
          error: `Invalid JSON arguments for ${call.name}: ${err instanceof Error ? err.message : String(err)}`,
        };
        if (echoToolResults) {
          messages.push({ role: 'tool', content: JSON.stringify(errorResult), toolResults: [{ name: call.name, result: errorResult }] });
        }
        continue;
      }

      let result: unknown;
      try {
        result = await runtime.callTool('', call.name, parsedArgs);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }

      if (echoToolResults) {
        messages.push({ role: 'tool', content: JSON.stringify(result), toolResults: [{ name: call.name, result }] });
      }
    }
  }

  // Budget exhausted: force a final answer from the last assistant message.
  const last = messages[messages.length - 1];
  return {
    messages,
    finished: true,
    finalAnswer: last.content || 'I ran out of tool-calling steps before reaching an answer.',
    toolCallsMade,
  };
}
