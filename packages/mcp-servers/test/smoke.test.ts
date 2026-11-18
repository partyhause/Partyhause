import { Harness } from '@partyhause/agentic-harness';

async function smoke() {
  const harness = new Harness({
    llm: {
      baseUrl: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
      apiKey: process.env.LLM_API_KEY || 'ollama',
      model: process.env.LLM_MODEL || 'llama3.1'
    },
    clients: {
      partyboard: {
        stdio: {
          command: 'node',
          args: ['--loader', 'ts-node/esm', '/Users/oluwaferanmi/Partyhause/packages/mcp-servers/src/partyboard/server.ts'],
          env: { PARTYHause_API_URL: process.env.PARTYHause_API_URL || 'http://localhost:8001/api' }
        }
      }
    },
    loop: { maxSteps: 3 }
  });

  await harness.connect();
  console.log('Tools:', harness.tools.map(t => t.name));
  
  const health = await harness.callTool('partyboard', 'health_check', {});
  console.log('Health:', health);

  await harness.close();
  console.log('Smoke test passed');
}

smoke().catch(e => { console.error(e); process.exit(1); });
