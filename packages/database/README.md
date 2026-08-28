# Phase 1 database package

This package stores exactly the two Phase 0 payloads plus the operational
`traceId` and `createdAt` fields needed by the Phase 1 backend demonstration.
It intentionally has no messaging, agent-run, Canvas, vector, scheduling, or
mastery tables.

## Local PostgreSQL and migrations

From the repository root:

```sh
pnpm --filter @math-study-companion/database db:up
pnpm --filter @math-study-companion/database db:migrate
```

The local container listens only on `127.0.0.1:54329` and uses PostgreSQL
`trust` authentication for this disposable local database. For another
database, set `DATABASE_URL` in the shell; do not commit credentials.

Run the repository integration tests against the local container with:

```sh
pnpm --filter @math-study-companion/database test:local
```

Use `db:down` to stop the container. The named volume remains so migration
history and data survive restarts.

## API handoff

Construct `PostgresInteractionRepository` with the API's shared `pg.Pool`.
Call `start(contextPayload, { traceId })`, then later call
`complete(routeInteractionId, resultPayload)`. Both payload parameters use the
shared contracts unchanged. Map the exported typed error `code` values to the
API's chosen HTTP responses. `getByInteractionId` and `listRecent` are the only
inspection reads. Completion is first-write-only; concurrent or repeated
results receive `DUPLICATE_RESULT` and cannot overwrite the original evidence.
