import assert from 'node:assert/strict';
import test from 'node:test';

import { DemoApiError } from '../src/api-client.js';
import { launchSendblueDemo } from '../src/sendblue-demo.js';

test('starts and launches hosted Sendblue with one trace and bearer token', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const responseBodies = [
    { status: 'ok' },
    {
      interactionId: 'judge-001',
      topic: 'linear equations',
      sourceText: 'Solve equations on both sides.',
      difficulty: 'easy',
      image: null,
      mode: 'PRACTISE',
      reason: 'Manual judge MVP demonstration',
    },
    {
      interactionId: 'judge-001',
      provider: 'sendblue',
      status: 'active',
    },
  ];
  const result = await launchSendblueDemo({
    apiUrl: 'https://judge.example.test',
    internalApiToken: 'internal-token',
    interactionId: 'judge-001',
    traceId: 'trace-001',
    fetchImplementation: (async (input, init) => {
      requests.push({ url: String(input), init: init! });
      return new Response(JSON.stringify(responseBodies.shift()), {
        status: requests.length === 2 ? 201 : requests.length === 3 ? 202 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });

  assert.deepEqual(result, {
    interactionId: 'judge-001',
    traceId: 'trace-001',
    status: 'queued',
  });
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      'https://judge.example.test/health',
      'https://judge.example.test/internal/demo/start?interactionId=judge-001',
      'https://judge.example.test/internal/demo/judge-001/launch',
    ],
  );
  for (const request of requests) {
    assert.equal(
      new Headers(request.init.headers).get('x-trace-id'),
      'trace-001',
    );
  }
  assert.equal(
    new Headers(requests[0]?.init.headers).get('authorization'),
    null,
  );
  assert.equal(
    new Headers(requests[1]?.init.headers).get('authorization'),
    'Bearer internal-token',
  );
  assert.equal(
    new Headers(requests[2]?.init.headers).get('authorization'),
    'Bearer internal-token',
  );
});

test('does not launch when hosted start fails', async () => {
  let calls = 0;
  await assert.rejects(
    launchSendblueDemo({
      apiUrl: 'https://judge.example.test',
      internalApiToken: 'internal-token',
      interactionId: 'duplicate',
      traceId: 'trace-002',
      fetchImplementation: (async () => {
        calls += 1;
        if (calls === 1) return json({ status: 'ok' }, 200);
        return json({ code: 'DUPLICATE_INTERACTION' }, 409);
      }) as typeof fetch,
    }),
    /409 DUPLICATE_INTERACTION/,
  );
  assert.equal(calls, 2);
});

test('preserves hosted API status, retryability, and returned trace ID', async () => {
  await assert.rejects(
    launchSendblueDemo({
      apiUrl: 'https://judge.example.test',
      internalApiToken: 'internal-token',
      interactionId: 'unavailable',
      traceId: 'client-trace',
      fetchImplementation: (async () =>
        json(
          {
            code: 'DATABASE_UNAVAILABLE',
            retryable: true,
            traceId: 'server-trace',
          },
          503,
        )) as typeof fetch,
    }),
    (error) =>
      error instanceof DemoApiError &&
      error.status === 503 &&
      error.code === 'DATABASE_UNAVAILABLE' &&
      error.retryable &&
      error.traceId === 'server-trace',
  );
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
