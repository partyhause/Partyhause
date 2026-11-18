# Coding Agent Harness as Event Planning Agent

## Intent
Use an OMP-style coding agent harness — similar to Oh My Pi coding agent — as the event planning and management agent for PartyHause. The agent should be able to:
- Use partyboard tools
- Affect timeline
- Manage live day features
- Access other app features via MCP

## Architecture

### Current components
- `@partyhause/agentic-harness` — small harness with MCP stdio/SSE, tool registry, ReAct loop, OpenAI-compatible LLM client
- `packages/mcp-servers/` — MCP servers exposing PartyHause features via Django API
- Django backend — API on port 8001, partyboard, timeline, events, guests

### Proposed coding agent integration
1. **Agent harness**
   - Use existing `@partyhause/agentic-harness` as base
   - Replace generic LLM client with coding agent runner that understands repo structure and can write code
   - Agent operates in a sandbox with read/write access to event data via MCP tools, not filesystem

2. **MCP exposure**
   - Expose all app features as MCP servers:
     - partyboard, timeline, liveday
     - invites, guests, polls, cost_split, storage
   - Each server uses shared `apiClient` with JWT forwarding
   - Tools follow JSON-RPC schema with Zod validation

3. **Onboarding**
   - During user onboarding, add step: "Enable AI Event Planner"
   - Consent for LLM tool use, provider selection
   - Create agent profile with capabilities
   - First-run guided planning session

4. **User experience**
   - Dashboard has "Ask AI Planner" chat
   - Agent can create stickies, schedule blocks, check in guests, send notifications
   - All actions logged and reversible
   - Agent suggestions require user confirmation for destructive actions

## Differences from generic MCP harness
- Coding agent harness can reason about code and data schemas
- Can generate event plans, refactor timelines, suggest optimizations
- Can write small automation scripts for recurring events

## Next steps
- Add JWT per-user forwarding to MCP servers
- Expand MCP servers to cover invites, guests, polls, cost_split
- Add onboarding step for agentic consent
- Build frontend chat UI for agent interaction
- Add audit logging for agent actions
