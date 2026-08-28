# Phase 1 internal demo API

This package implements only the Platform-side Phase 1 demo loop:

```text
manual start -> canonical context -> canonical result -> saved interaction
```

It deliberately has no agent, evaluation, messaging provider, webhook, Canvas integration,
scheduler, authentication, image generation, or admin UI.

## Run

Node.js 22 or newer is required.

```bash
pnpm install
pnpm --filter @math-study-companion/api test
pnpm --filter @math-study-companion/api build
pnpm --filter @math-study-companion/api start
```

The API listens on `127.0.0.1:3000` by default. `HOST` and `PORT` may be set explicitly.
State is intentionally in memory and is reset when the process exits.

## Manual demo

Start the API, then run:

```bash
curl -i http://127.0.0.1:3000/health

curl -i -X POST http://127.0.0.1:3000/internal/demo/start

curl -i -X POST http://127.0.0.1:3000/internal/demo/demo-001/result \
  -H 'content-type: application/json' \
  -d '{
    "interactionId": "demo-001",
    "question": "Solve 2x + 3 = 11.",
    "studentReply": "x = 4",
    "feedback": "Correct — subtract 3, then divide by 2.",
    "result": "correct"
  }'

curl -i http://127.0.0.1:3000/internal/demo/demo-001

curl -i http://127.0.0.1:3000/internal/demo
```

`POST /internal/demo/start` returns the exact Phase 0 backend-context payload. The trace ID
is returned in the `x-trace-id` response header and stored with the interaction. Result and
inspection responses reuse that stored trace ID.

## Shared contracts integration

Both boundary payloads are parsed with the runtime schemas exported by
`@math-study-companion/contracts`: `backendToConversationSchema` for the configured fixture and
`conversationToBackendSchema` for submitted results. The shared package is a workspace dependency;
the API has no duplicate payload schema.

## PostgreSQL repository handoff

Adapt the database package's `PostgresInteractionRepository` to `DemoInteractionRepository` from
`src/repository.ts`, then inject that adapter into `createDemoApp({ repository })`. The API-facing
port intentionally needs only four atomic operations:

- create an interaction and report a duplicate;
- find an interaction by ID;
- list interactions;
- save the first result and report not-found or already-completed.

The current database package already provides `start`, `complete`, `getByInteractionId`, and
`listRecent`, but a bridge still needs to map its flattened `StoredInteraction` to the API's nested
record and translate its typed errors into the API outcome values. Before connecting it, the
database completion must become first-write-only (a conditional update or row-locked check) so a
duplicate result cannot overwrite the original evidence. The persisted model also needs a nullable
completion timestamp if `completedAt` is to survive process restarts. Those repository and migration
changes are intentionally outside `apps/api` ownership.

## Logs and errors

Logs are one-line JSON with event, trace ID, interaction ID when known, method, path, and status.
Request bodies are never logged, so the student reply and credentials cannot be copied into logs.
Errors follow the documented `{ code, message, retryable, traceId, details? }` shape.
