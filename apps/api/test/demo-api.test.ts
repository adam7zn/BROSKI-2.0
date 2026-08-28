import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';

import { createDemoApp, type CreateDemoAppOptions } from '../src/app.js';
import type {
  ConversationResult,
  StoredDemoInteraction,
} from '../src/domain.js';
import type { LogEntry, Logger } from '../src/logger.js';

const canonicalResult: ConversationResult = {
  interactionId: 'demo-001',
  question: 'Solve 2x + 3 = 11.',
  studentReply: 'x = 4',
  feedback: 'Correct — subtract 3, then divide by 2.',
  result: 'correct',
};

const runningServers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
});

describe('Phase 1 demo API', () => {
  it('proves start -> result -> retrieve with one trace ID', async () => {
    const app = await startApp();

    const health = await fetch(`${app.baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const start = await fetch(`${app.baseUrl}/internal/demo/start`, {
      method: 'POST',
    });
    assert.equal(start.status, 201);
    const traceId = start.headers.get('x-trace-id');
    assert.match(traceId ?? '', /^[0-9a-f-]{36}$/);
    assert.deepEqual(await start.json(), {
      interactionId: 'demo-001',
      topic: 'linear equations',
      sourceText:
        'Solve equations by applying the same operation to both sides.',
      difficulty: 'easy',
      image: null,
    });

    const result = await fetch(`${app.baseUrl}/internal/demo/demo-001/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(canonicalResult),
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('x-trace-id'), traceId);
    const saved = (await result.json()) as StoredDemoInteraction;
    assert.equal(saved.traceId, traceId);
    assert.deepEqual(saved.result, canonicalResult);
    assert.ok(saved.startedAt);
    assert.ok(saved.completedAt);

    const retrieve = await fetch(`${app.baseUrl}/internal/demo/demo-001`);
    assert.equal(retrieve.status, 200);
    assert.equal(retrieve.headers.get('x-trace-id'), traceId);
    assert.deepEqual(await retrieve.json(), saved);

    const list = await fetch(`${app.baseUrl}/internal/demo`);
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { interactions: [saved] });
  });

  it('returns structured failures for duplicate start, invalid result, mismatch, and not found', async () => {
    const entries: LogEntry[] = [];
    const app = await startApp({ logger: collectingLogger(entries) });

    const start = await fetch(`${app.baseUrl}/internal/demo/start`, {
      method: 'POST',
      headers: { 'x-trace-id': 'demo-trace' },
    });
    assert.equal(start.status, 201);

    const duplicate = await fetch(`${app.baseUrl}/internal/demo/start`, {
      method: 'POST',
    });
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), {
      code: 'DUPLICATE_INTERACTION',
      message: 'Interaction demo-001 has already been started',
      retryable: false,
      traceId: 'demo-trace',
      details: { interactionId: 'demo-001' },
    });

    const secretReply = 'do-not-copy-this-reply';
    const invalid = await postJson(
      app.baseUrl,
      '/internal/demo/demo-001/result',
      {
        ...canonicalResult,
        studentReply: secretReply,
        result: false,
      },
    );
    assert.equal(invalid.status, 400);
    const invalidBody = await invalid.json();
    assert.equal(invalidBody.code, 'INVALID_CONVERSATION_RESULT');
    assert.equal(invalidBody.traceId, 'demo-trace');
    assert.equal(JSON.stringify(invalidBody).includes(secretReply), false);

    const mismatch = await postJson(
      app.baseUrl,
      '/internal/demo/demo-001/result',
      {
        ...canonicalResult,
        interactionId: 'demo-002',
      },
    );
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).code, 'INTERACTION_ID_MISMATCH');

    const missing = await fetch(`${app.baseUrl}/internal/demo/missing`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'INTERACTION_NOT_FOUND');

    const missingResult = await postJson(
      app.baseUrl,
      '/internal/demo/missing/result',
      {
        ...canonicalResult,
        interactionId: 'missing',
      },
    );
    assert.equal(missingResult.status, 404);
    assert.equal((await missingResult.json()).code, 'INTERACTION_NOT_FOUND');

    assert.equal(JSON.stringify(entries).includes(secretReply), false);
    assert.ok(entries.every((entry) => entry.traceId.length > 0));
    assert.ok(entries.some((entry) => entry.interactionId === 'demo-001'));
  });

  it('rejects malformed JSON and a second result without overwriting the first', async () => {
    const app = await startApp();
    await fetch(`${app.baseUrl}/internal/demo/start`, { method: 'POST' });

    const malformed = await fetch(
      `${app.baseUrl}/internal/demo/demo-001/result`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      },
    );
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, 'INVALID_JSON');

    const first = await postJson(
      app.baseUrl,
      '/internal/demo/demo-001/result',
      canonicalResult,
    );
    assert.equal(first.status, 200);

    const second = await postJson(
      app.baseUrl,
      '/internal/demo/demo-001/result',
      {
        ...canonicalResult,
        feedback: 'A replacement that must not be persisted',
      },
    );
    assert.equal(second.status, 409);
    assert.equal((await second.json()).code, 'DUPLICATE_RESULT');

    const retrieved = await fetch(`${app.baseUrl}/internal/demo/demo-001`);
    const record = (await retrieved.json()) as StoredDemoInteraction;
    assert.deepEqual(record.result, canonicalResult);
  });

  it('validates the outgoing fixture and preserves a static image reference', async () => {
    const withImage = await startApp({
      contextFixture: {
        interactionId: 'demo-image',
        topic: 'linear equations',
        sourceText:
          'Solve equations by applying the same operation to both sides.',
        difficulty: 'easy',
        image: '/static/demo-linear-equation.png',
      },
    });
    const valid = await fetch(`${withImage.baseUrl}/internal/demo/start`, {
      method: 'POST',
    });
    assert.equal(valid.status, 201);
    assert.equal(
      (await valid.json()).image,
      '/static/demo-linear-equation.png',
    );

    const invalidFixture = await startApp({
      contextFixture: {
        interactionId: 'demo-invalid',
        topic: 'linear equations',
        sourceText: 'Source',
        difficulty: 'easy',
        image: 42,
      } as never,
    });
    const invalid = await fetch(
      `${invalidFixture.baseUrl}/internal/demo/start`,
      {
        method: 'POST',
      },
    );
    assert.equal(invalid.status, 500);
    assert.equal((await invalid.json()).code, 'INVALID_BACKEND_CONTEXT');
  });
});

async function startApp(options: CreateDemoAppOptions = {}) {
  const { server } = await createDemoApp(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const running = {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  runningServers.push(running);
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function collectingLogger(entries: LogEntry[]): Logger {
  return {
    write(entry) {
      entries.push(entry);
    },
  };
}
