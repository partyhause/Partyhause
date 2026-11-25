/**
 * @partyhause/agentic-harness
 *
 * Small agentic harness with MCP (stdio + SSE) connections for AI chat.
 *
 * Connects to MCP servers, discovers their tools, and runs a tool-using agent
 * loop against any OpenAI-compatible LLM. The harness owns the LLM client and
 * the tool registry; the agent loop is pure orchestration.
 *
 * Example:
 *
 *   import { Harness } from '@partyhause/agentic-harness';
 *
 *   const harness = new Harness({
 *     llm: { baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: process.env.NVIDIA_API_KEY!, model: 'nvidia/nemotron-...' },
 *     clients: { fs: { stdio: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] } } },
 *   });
 *   await harness.connect();
 *   const answer = await harness.ask('You are a helpful agent.', 'List the files in the current directory.');
 *   console.log(answer);
 *   await harness.close();
 */

export { Harness } from './harness.js';
export type { HarnessOptions, McpClientConfig } from './harness.js';

export { runAgentLoop } from './agent/loop.js';
export type { AgentMessage, AgentRuntime, AgentTurnResult, AgentLoopOptions } from './agent/loop.js';

export { OpenAIRuntime, toOpenAITools } from './agent/llm.js';
export type { LlmOptions } from './agent/llm.js';

export { StdioMcpTransport, SseMcpTransport } from './mcp/transports.js';
export type { McpTransport } from './mcp/transport.js';
export type { McpTool, McpConnectionState } from './mcp/protocol.js';
export { initialize } from './mcp/client.js';
export type { McpClientInitializeResult } from './mcp/client.js';

export { McpError, TransportClosedError } from './mcp/protocol.js';
