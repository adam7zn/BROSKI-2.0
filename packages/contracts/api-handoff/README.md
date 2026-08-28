# API handoff: Phase 0 contracts

Use the shared contracts package at the API boundary. Do not duplicate these
schemas or import files from inside `packages/contracts/src`.

## Public imports

```ts
import {
  backendToConversationSchema,
  conversationToBackendSchema,
  type BackendToConversation,
  type ConversationToBackend,
} from '@math-study-companion/contracts';
```

The TypeScript types are inferred from the runtime schemas. Use the schemas to
validate untrusted runtime data; type annotations alone do not validate data.

## Backend-to-conversation response

Validate the context payload immediately before returning it from the API:

```ts
const payload: BackendToConversation =
  backendToConversationSchema.parse(context);

return Response.json(payload);
```

`parse` throws a Zod validation error if the backend produced an invalid
payload. Convert that error into the API's normal internal-error response and
log only the information allowed by the project's logging rules.

## Conversation-to-backend request

Treat the request body as unknown and validate it before using or storing it:

```ts
const requestBody: unknown = await request.json();
const validation = conversationToBackendSchema.safeParse(requestBody);

if (!validation.success) {
  return Response.json({ error: 'Invalid payload' }, { status: 400 });
}

const payload: ConversationToBackend = validation.data;

// Pass payload to the backend use case or repository here.
```

Do not add fields, defaults, coercion, or API-specific variants to these Phase 0
payloads. Propose any boundary change in the contracts package first.

## Canonical fixtures

Applications and tests can load these repository fixtures:

- `fixtures/contracts/backend-to-conversation.json`
- `fixtures/contracts/conversation-to-backend.json`

Use them for API response and request tests so both workstreams exercise the
same boundary examples.

## Verification

From the repository root, run the focused contracts tests with:

```sh
pnpm --filter @math-study-companion/contracts test
```

The root Vitest configuration must include package tests if the scaffold expects
the root-level `pnpm test` command to run this suite.
