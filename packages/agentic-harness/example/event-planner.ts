import { Harness } from '@partyhause/agentic-harness';
import { EventPlannerAgent } from '../src/agent/event-planner.js';

const harness = new Harness({
  llm: {
    baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY || '',
    model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b',
    temperature: 1,
    topP: 0.95,
    maxTokens: 16384,
    seed: 42,
  },
  clients: {
    partyboard: {
      stdio: { command: 'node', args: ['packages/mcp-servers/src/partyboard/server.ts'] }
    },
    timeline: {
      stdio: { command: 'node', args: ['packages/mcp-servers/src/timeline/server.ts'] }
    },
    liveday: {
      stdio: { command: 'node', args: ['packages/mcp-servers/src/liveday/server.ts'] }
    }
  }
});

await harness.connect();

const agent = new EventPlannerAgent(harness);

const userId = 'user123';
const eventId = 'event456';

const response = await agent.converse(userId, 'Plan my event timeline and create welcome sticky notes', eventId);
console.log(response);

await harness.close();
