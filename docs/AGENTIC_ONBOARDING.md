# Agentic Harness Onboarding

## Goal
Expose PartyHause planning features to an Open Manus Protocol agentic harness via MCP, and onboard new users to agentic capabilities during user onboarding.

## Current State
- Small agentic harness implemented at `packages/agentic-harness` with MCP stdio/SSE, tool registry, ReAct loop, OpenAI-compatible LLM.
- MCP servers provided for `partyboard`, `timeline`, `liveday` under `packages/mcp-servers`.
- Onboarding is username picker only: no agentic consent or AI planner step.
- No frontend chat UI for an agent yet.

## Steps
1. **Keep the harness, make it coding-aware** — existing harness already routes tools via MCP. Add coding-agent runner that understands PartyHause schemas and can generate plans, refactor timelines, suggest optimizations.
2. **Expand MCP exposure** — currently `partyboard/timeline/liveday`. Need invites, guests, polls, cost_split, storage servers, all sharing JWT-forwarding client.
3. **Onboarding design change** — enable AI event planner toggle, provider choice / consent for LLM tool use, first-run guided planning session.
4. **User experience** — dashboard "Ask AI Planner" chat uses tools to create stickies, schedule blocks, check-in guests, send notifications. Destructive actions require confirmation. All actions audited.

## Destructive actions
Require explicit confirmation before executing tools that mutate state: create/delete stickies, move timeline blocks, check-in guests, push notifications.

## Next
Wire harness to inject user JWT into MCP server calls, and extend onboarding step to collect agentic consent.
