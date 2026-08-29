# Internal judge demo API

This package retains the Platform-side Phase 1 loop and adds the narrow persistence needed for the
first real-message judge demonstration:

```text
manual start -> profile and delivery metadata -> canonical result -> saved interaction
```

The iMessage process remains in `apps/companion`; route and application logic still depend only on
repository ports. There is no webhook, Canvas integration, scheduler, authentication system,
generated image, or model-backed agent.

## Run with Supabase

Node.js 22 or newer is required.

```bash
pnpm install
pnpm --filter @math-study-companion/api build
cp .env.example .env.supabase
# Replace the DATABASE_URL password placeholder, or use the configured macOS Keychain item.
pnpm db:migrate:supabase
pnpm api:start:supabase
```

The API listens on `127.0.0.1:3000` by default. `HOST` and `PORT` may be set explicitly.
When `DATABASE_URL` is present, startup requires a reachable, migrated PostgreSQL database and
does not fall back silently. Without `DATABASE_URL`, the API uses memory. Set
`DEMO_REPOSITORY=memory` to request the disposable in-memory adapter explicitly, including when a
database URL is present.

The hosted API uses Supabase as PostgreSQL through the existing repository adapter; it does not use
the Supabase Data API or duplicate contract validation. The explicit hosted scripts accept a
deployment-provided `DATABASE_URL`, an ignored `.env.supabase`, or the configured macOS Keychain
item. In every case they use the Session pooler on port 5432 with
`sslmode=require&uselibpqcompat=true`.

## Local tests

```bash
pnpm db:up
pnpm db:migrate
pnpm --filter @math-study-companion/api test:unit
pnpm --filter @math-study-companion/api test:postgres
```

Local Docker is the disposable test adapter for development and CI. It is not a runtime fallback
when the hosted `DATABASE_URL` is supplied.

## Manual demo

Start the API, then run:

```bash
curl -i http://127.0.0.1:3000/health

curl -i -X POST http://127.0.0.1:3000/internal/demo/start

# A hosted rehearsal may request a fresh validated ID instead of deleting old evidence.
curl -i -X POST 'http://127.0.0.1:3000/internal/demo/start?interactionId=judge-rehearsal-001'

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

curl -i http://127.0.0.1:3000/internal/demo/profile
curl -i http://127.0.0.1:3000/internal/demo/demo-001/events
```

The same canonical flow can be run with `pnpm demo:supabase`. Restart
`pnpm api:start:supabase` afterward and retrieve `/internal/demo/demo-001` to verify that Supabase
retained the completed interaction.

`POST /internal/demo/start` returns the Phase 0 fields plus backward-compatible `mode` and `reason`
defaults. The trace ID
is returned in the `x-trace-id` response header and stored with the interaction. Result and
inspection responses reuse that stored trace ID.

## Shared contracts integration

Both boundary payloads are parsed with the runtime schemas exported by
`@math-study-companion/contracts`: `backendToConversationSchema` for the configured fixture and
`conversationToBackendSchema` for submitted results. The shared package is a workspace dependency;
the API has no duplicate payload schema.

## Persistence design

`PostgresDemoInteractionRepositoryAdapter` maps the database package's flat record and typed errors
to the API's nested `DemoInteractionRepository` port. Route and application code use only the
repository port operations, including the judge-only profile and delivery ledger:

- create an interaction and report a duplicate;
- find an interaction by ID;
- list interactions;
- save the first result and report not-found or already-completed.
- save/retrieve the one synthetic profile;
- reserve one outbound idempotency key before delivery;
- append and deduplicate normalized message events without storing message bodies.

PostgreSQL stores `completed_at` with the first result. Its row lock and typed duplicate-result error
ensure a repeated or concurrent completion cannot replace the original payload or timestamp. The
in-memory implementation follows the same outcomes and remains the focused unit-test adapter.

## Logs and errors

Logs are one-line JSON with event, trace ID, interaction ID when known, method, path, and status.
Request bodies are never logged, so the student reply and credentials cannot be copied into logs.
Errors follow the documented `{ code, message, retryable, traceId, details? }` shape.
