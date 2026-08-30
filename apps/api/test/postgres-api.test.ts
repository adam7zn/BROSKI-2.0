import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { runMigrations } from '@math-study-companion/database';
import { Pool } from 'pg';

import type {
  BackendContext,
  ConversationResult,
  StoredDemoInteraction,
} from '../src/domain.js';
import { createConfiguredDemoApp } from '../src/persistence.js';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres@127.0.0.1:54329/math_study_companion';

const setupPool = new Pool({ connectionString });
const internalApiToken = 'postgres-api-test-token';
let context: BackendContext;
let result: ConversationResult;

before(async () => {
  [context, result] = await Promise.all([
    loadFixture<BackendContext>('backend-to-conversation.json'),
    loadFixture<ConversationResult>('conversation-to-backend.json'),
  ]);
  context = {
    ...context,
    mode: 'PRACTISE',
    reason: 'Manual judge MVP demonstration',
  };
  await runMigrations(setupPool);
  await setupPool.query('TRUNCATE demo_profiles, interactions CASCADE');
});

after(async () => {
  await setupPool.query('TRUNCATE demo_profiles, interactions CASCADE');
  await setupPool.end();
});

test('PostgreSQL preserves the canonical HTTP flow across API recreation', async () => {
  const firstApi = await startPostgresApi();

  const start = await fetch(`${firstApi.baseUrl}/internal/demo/start`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${internalApiToken}`,
      'x-trace-id': 'postgres-trace-001',
    },
  });
  assert.equal(start.status, 201);
  assert.deepEqual(await start.json(), context);

  const profile = await fetch(`${firstApi.baseUrl}/internal/demo/profile`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${internalApiToken}`,
      'x-trace-id': 'postgres-trace-001',
    },
    body: JSON.stringify({
      course: 'Mathematics 3c',
      selfAssessedLevel: 'okay',
      previousGrade: 'C',
    }),
  });
  assert.equal(profile.status, 200);

  const reservation = await postJson(
    firstApi.baseUrl,
    `/internal/demo/${context.interactionId}/outbound/reserve`,
    { idempotencyKey: 'demo-001:question' },
  );
  assert.equal(reservation.status, 201);
  const inboundEvent = {
    provider: 'imessage-cli',
    direction: 'inbound',
    eventType: 'received',
    providerEventId: 'postgres-inbound-guid-1',
    providerMessageId: 'postgres-inbound-guid-1',
    idempotencyKey: null,
    occurredAt: '2026-08-29T08:00:00.000Z',
  };
  const event = await postJson(
    firstApi.baseUrl,
    `/internal/demo/${context.interactionId}/events`,
    inboundEvent,
  );
  assert.equal(event.status, 201);

  const completion = await postJson(
    firstApi.baseUrl,
    `/internal/demo/${context.interactionId}/result`,
    result,
  );
  assert.equal(completion.status, 200);
  const completed = (await completion.json()) as StoredDemoInteraction;
  assert.equal(completed.traceId, 'postgres-trace-001');
  assert.deepEqual(completed.context, context);
  assert.deepEqual(completed.result, result);
  assert.ok(completed.completedAt);

  await firstApi.close();

  const restartedApi = await startPostgresApi();
  try {
    const retrieve = await fetch(
      `${restartedApi.baseUrl}/internal/demo/${context.interactionId}`,
      { headers: internalHeaders() },
    );
    assert.equal(retrieve.status, 200);
    assert.equal(retrieve.headers.get('x-trace-id'), 'postgres-trace-001');
    assert.deepEqual(await retrieve.json(), completed);

    const savedProfile = await fetch(
      `${restartedApi.baseUrl}/internal/demo/profile`,
      { headers: internalHeaders() },
    );
    assert.equal(savedProfile.status, 200);
    assert.equal((await savedProfile.json()).course, 'Mathematics 3c');
    const eventsPath = `/internal/demo/${context.interactionId}/events`;
    const savedEvents = await fetch(`${restartedApi.baseUrl}${eventsPath}`, {
      headers: internalHeaders(),
    });
    assert.equal((await savedEvents.json()).events.length, 1);
    const duplicateEvent = await postJson(
      restartedApi.baseUrl,
      eventsPath,
      inboundEvent,
    );
    assert.equal(duplicateEvent.status, 200);
    assert.equal((await duplicateEvent.json()).outcome, 'duplicate');

    const duplicateStart = await fetch(
      `${restartedApi.baseUrl}/internal/demo/start`,
      { method: 'POST', headers: internalHeaders() },
    );
    assert.equal(duplicateStart.status, 409);
    assert.equal((await duplicateStart.json()).code, 'DUPLICATE_INTERACTION');

    const duplicateCompletion = await postJson(
      restartedApi.baseUrl,
      `/internal/demo/${context.interactionId}/result`,
      { ...result, feedback: 'This must not replace the original result.' },
    );
    assert.equal(duplicateCompletion.status, 409);
    assert.equal((await duplicateCompletion.json()).code, 'DUPLICATE_RESULT');

    const mismatch = await postJson(
      restartedApi.baseUrl,
      `/internal/demo/${context.interactionId}/result`,
      { ...result, interactionId: 'demo-002' },
    );
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).code, 'INTERACTION_ID_MISMATCH');

    const missing = await fetch(
      `${restartedApi.baseUrl}/internal/demo/missing-interaction`,
      { headers: internalHeaders() },
    );
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'INTERACTION_NOT_FOUND');

    const missingCompletion = await postJson(
      restartedApi.baseUrl,
      '/internal/demo/missing-interaction/result',
      { ...result, interactionId: 'missing-interaction' },
    );
    assert.equal(missingCompletion.status, 404);
    assert.equal(
      (await missingCompletion.json()).code,
      'INTERACTION_NOT_FOUND',
    );

    const unchanged = await fetch(
      `${restartedApi.baseUrl}/internal/demo/${context.interactionId}`,
      { headers: internalHeaders() },
    );
    assert.deepEqual(await unchanged.json(), completed);
  } finally {
    await restartedApi.close();
  }
});

async function startPostgresApi() {
  const runtime = await createConfiguredDemoApp({
    environment: {
      DATABASE_URL: connectionString,
      INTERNAL_API_TOKEN: internalApiToken,
    },
  });
  assert.equal(runtime.persistence, 'postgresql');
  await new Promise<void>((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, '127.0.0.1', resolve);
  });
  const address = runtime.server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        runtime.server.close((error) => (error ? reject(error) : resolve()));
      });
      await runtime.close();
    },
  };
}

async function loadFixture<T>(name: string): Promise<T> {
  const fixtureUrl = new URL(
    `../../../fixtures/contracts/${name}`,
    import.meta.url,
  );
  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as T;
}

function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...internalHeaders(),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function internalHeaders(): Record<string, string> {
  return { authorization: `Bearer ${internalApiToken}` };
}
