# PartyHause MCP Servers

Small MCP servers exposing PartyHause features to an agentic harness.

## Servers

- `src/partyboard/server.ts` — Partyboard CRUD: list/create/vote/move sticky, tasks.
- `src/timeline/server.ts` — Timeline blocks, free slots, schedule.
- `src/liveday/server.ts` — Live day status, check-in, attendance, notifications.

## Usage

```bash
PARTYHause_API_URL=http://localhost:8001/api node --loader ts-node/esm src/partyboard/server.ts
```

Connect from `@partyhause/agentic-harness` via stdio MCP client config.
