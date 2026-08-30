import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';

import type { VerifiedExerciseContext } from '@math-study-companion/contracts';
import { ClaudeConversationAgent } from '@math-study-companion/conversation';

import { createDemoApp, type CreateDemoAppOptions } from '../src/app.js';
import type {
  ConversationResult,
  StoredDemoInteraction,
} from '../src/domain.js';
import type { LogEntry, Logger } from '../src/logger.js';
import { InMemoryExerciseCatalogRepository } from '../src/exercise-repository.js';
import {
  buildConversationAgent,
  createConfiguredDemoApp,
} from '../src/persistence.js';

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
  it('selects explicit memory persistence and never silently falls back from PostgreSQL', async () => {
    const memory = await createConfiguredDemoApp({
      environment: {
        DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/unreachable',
        DEMO_REPOSITORY: 'memory',
        INTERNAL_API_TOKEN: 'memory-test-token',
      },
    });
    assert.equal(memory.persistence, 'memory');
    await memory.close();

    await assert.rejects(
      createConfiguredDemoApp({
        environment: {
          DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/unreachable',
          INTERNAL_API_TOKEN: 'postgres-test-token',
        },
      }),
    );
  });

  it('requires internal authentication and complete live messaging configuration at startup', async () => {
    await assert.rejects(
      createConfiguredDemoApp({ environment: { DEMO_REPOSITORY: 'memory' } }),
      /INTERNAL_API_TOKEN is required/,
    );
    await assert.rejects(
      createConfiguredDemoApp({
        environment: {
          DEMO_REPOSITORY: 'memory',
          INTERNAL_API_TOKEN: 'test-token',
          MESSAGING_LIVE_ENABLED: 'true',
        },
      }),
      /requires hosted Sendblue messaging configuration/,
    );
  });

  it('selects Anthropic explicitly and never falls back when its key is missing', () => {
    assert.throws(
      () =>
        buildConversationAgent({ CONVERSATION_AGENT_PROVIDER: 'anthropic' }),
      /ANTHROPIC_API_KEY is required/,
    );
    assert.throws(
      () => buildConversationAgent({ CONVERSATION_AGENT_PROVIDER: 'other' }),
      /must be deterministic or anthropic/,
    );
    assert.throws(
      () =>
        buildConversationAgent({
          CONVERSATION_AGENT_PROVIDER: 'anthropic',
          ANTHROPIC_API_KEY: 'synthetic-test-key',
          SCREEN_RECORDING_DEMO_ENABLED: 'sometimes',
        }),
      /SCREEN_RECORDING_DEMO_ENABLED must be true or false/,
    );
    assert.ok(
      buildConversationAgent({
        CONVERSATION_AGENT_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'synthetic-test-key',
        MSC_MODEL: 'claude-sonnet-5',
        SCREEN_RECORDING_DEMO_ENABLED: 'true',
      }) instanceof ClaudeConversationAgent,
    );
  });

  it('lists verified metadata and starts an exact manually selected exercise', async () => {
    const app = await startApp({
      internalApiToken: 'exercise-test-token',
      exerciseRepository: new InMemoryExerciseCatalogRepository([
        verifiedExercise,
      ]),
    });
    const unauthorized = await fetch(`${app.baseUrl}/internal/exercises`);
    assert.equal(unauthorized.status, 401);

    const headers = { authorization: 'Bearer exercise-test-token' };
    const list = await fetch(`${app.baseUrl}/internal/exercises`, { headers });
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.equal(listed.exercises.length, 1);
    assert.equal(listed.exercises[0].exerciseId, verifiedExercise.exerciseId);
    assert.equal(
      JSON.stringify(listed).includes(verifiedExercise.prompt),
      false,
    );
    assert.equal(JSON.stringify(listed).includes('answer-42'), false);

    const started = await fetch(
      `${app.baseUrl}/internal/exercises/${verifiedExercise.exerciseId}/start?interactionId=verified-run-001`,
      { method: 'POST', headers },
    );
    assert.equal(started.status, 201);
    const context = await started.json();
    assert.equal(context.sourceText, verifiedExercise.prompt);
    assert.equal(context.topic, verifiedExercise.topic);

    const stored = await fetch(
      `${app.baseUrl}/internal/demo/verified-run-001`,
      { headers },
    );
    assert.equal(stored.status, 200);
    assert.equal((await stored.json()).exerciseId, verifiedExercise.exerciseId);

    const missing = await fetch(
      `${app.baseUrl}/internal/exercises/55555555-5555-4555-8555-555555555555/start`,
      { method: 'POST', headers },
    );
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'VERIFIED_EXERCISE_NOT_FOUND');
  });

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
      mode: 'PRACTISE',
      reason: 'Manual judge MVP demonstration',
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

  it('stores the profile and deduplicates reservations and message events', async () => {
    const app = await startApp();
    const traceId = 'judge-trace-001';
    await fetch(`${app.baseUrl}/internal/demo/start`, {
      method: 'POST',
      headers: { 'x-trace-id': traceId },
    });

    const profile = await fetch(`${app.baseUrl}/internal/demo/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-trace-id': traceId,
      },
      body: JSON.stringify({
        course: 'Mathematics 3c',
        selfAssessedLevel: 'okay',
        previousGrade: 'C',
      }),
    });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).profileId, 'demo-student');

    const reservationPath = '/internal/demo/demo-001/outbound/reserve';
    const reservation = { idempotencyKey: 'demo-001:question' };
    assert.equal(
      (await postJson(app.baseUrl, reservationPath, reservation)).status,
      201,
    );
    const duplicateReservation = await postJson(
      app.baseUrl,
      reservationPath,
      reservation,
    );
    assert.equal(duplicateReservation.status, 200);
    assert.equal((await duplicateReservation.json()).outcome, 'duplicate');

    const event = {
      provider: 'imessage-cli',
      direction: 'inbound',
      eventType: 'received',
      providerEventId: 'incoming-guid-1',
      providerMessageId: 'incoming-guid-1',
      idempotencyKey: null,
      occurredAt: '2026-08-29T08:00:00.000Z',
    };
    const eventPath = '/internal/demo/demo-001/events';
    assert.equal((await postJson(app.baseUrl, eventPath, event)).status, 201);
    const duplicateEvent = await postJson(app.baseUrl, eventPath, event);
    assert.equal(duplicateEvent.status, 200);
    assert.equal((await duplicateEvent.json()).outcome, 'duplicate');

    const savedProfile = await fetch(`${app.baseUrl}/internal/demo/profile`);
    assert.equal(savedProfile.headers.get('x-trace-id'), traceId);
    assert.equal((await savedProfile.json()).course, 'Mathematics 3c');
    const events = await fetch(`${app.baseUrl}${eventPath}`);
    const eventsBody = await events.json();
    assert.equal(events.headers.get('x-trace-id'), traceId);
    assert.equal(eventsBody.events.length, 1);

    const invalidProfile = await fetch(`${app.baseUrl}/internal/demo/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        course: 'Mathematics 3c',
        selfAssessedLevel: 'expert',
        previousGrade: null,
      }),
    });
    assert.equal(invalidProfile.status, 400);
    assert.equal((await invalidProfile.json()).code, 'INVALID_DEMO_PROFILE');
  });

  it('supports a fresh, validated judge-run interaction ID', async () => {
    const app = await startApp();
    const start = await fetch(
      `${app.baseUrl}/internal/demo/start?interactionId=judge-rehearsal-001`,
      { method: 'POST', headers: { 'x-trace-id': 'judge-run-trace' } },
    );
    assert.equal(start.status, 201);
    assert.equal((await start.json()).interactionId, 'judge-rehearsal-001');

    const invalid = await fetch(
      `${app.baseUrl}/internal/demo/start?interactionId=${encodeURIComponent('not allowed')}`,
      { method: 'POST' },
    );
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'INVALID_INTERACTION_ID');
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
        mode: 'PRACTISE',
        reason: 'Manual judge MVP demonstration',
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
        mode: 'PRACTISE',
        reason: 'Manual judge MVP demonstration',
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

const verifiedExercise: VerifiedExerciseContext = {
  exerciseId: '11111111-1111-4111-8111-111111111111',
  sourceDocumentId: '22222222-2222-4222-8222-222222222222',
  sourcePageId: '33333333-3333-4333-8333-333333333333',
  sourceBlockId: '44444444-4444-4444-8444-444444444444',
  sourceBoundingBox: [0.1, 0.2, 0.7, 0.1],
  printedPageNumber: '13',
  sectionCode: '1.1',
  sectionTitle: 'Synthetic section',
  exerciseNumber: 'S-42',
  partLabel: 'a',
  topic: 'Synthetic algebra',
  prompt: 'Synthetic private prompt: compute the test value.',
  answerPayload: { canonical: 'answer-42', accepted: [] },
  solutionText: 'Apply the synthetic test operation.',
  rubric: 'Accept only the synthetic expected value.',
  difficulty: 'medium',
  gradingStrategy: 'rubric',
  contentChecksum: 'a'.repeat(64),
  verificationState: 'verified',
  verifiedBy: 'test-reviewer',
  verifiedAt: '2026-08-30T08:00:00.000Z',
};
