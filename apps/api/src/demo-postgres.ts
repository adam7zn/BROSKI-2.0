import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type {
  BackendContext,
  ConversationResult,
  StoredDemoInteraction,
} from './domain.js';

const baseUrl = apiBaseUrl(process.env.API_BASE_URL);
const [context, result] = await Promise.all([
  loadFixture<BackendContext>('backend-to-conversation.json'),
  loadFixture<ConversationResult>('conversation-to-backend.json'),
]);

const health = await requestJson('/health');
assert.deepEqual(health.body, { status: 'ok' });

const started = await requestJson('/internal/demo/start', { method: 'POST' });
assert.equal(started.status, 201);
assert.deepEqual(started.body, context);

const completed = await requestJson(
  `/internal/demo/${encodeURIComponent(context.interactionId)}/result`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  },
);
assert.equal(completed.status, 200);
const completedInteraction = completed.body as StoredDemoInteraction;
assert.deepEqual(completedInteraction.context, context);
assert.deepEqual(completedInteraction.result, result);
assert.match(completedInteraction.completedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);

const retrieved = await requestJson(
  `/internal/demo/${encodeURIComponent(context.interactionId)}`,
);
assert.deepEqual(retrieved.body, completedInteraction);

process.stdout.write(
  `${JSON.stringify({
    status: 'passed',
    interactionId: completedInteraction.interactionId,
    traceId: completedInteraction.traceId,
    completedAt: completedInteraction.completedAt,
  })}\n`,
);

async function requestJson(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const code =
      typeof body === 'object' && body !== null && 'code' in body
        ? String(body.code)
        : 'UNKNOWN_ERROR';
    throw new Error(
      `Demo request failed with HTTP ${response.status} (${code}).`,
    );
  }

  return { status: response.status, body };
}

async function loadFixture<T>(name: string): Promise<T> {
  const fixtureUrl = new URL(
    `../../../fixtures/contracts/${name}`,
    import.meta.url,
  );
  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as T;
}

function apiBaseUrl(value: string | undefined): string {
  const parsed = new URL(value ?? 'http://127.0.0.1:3000');
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('API_BASE_URL must use HTTP or HTTPS.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      'API_BASE_URL must not contain credentials, query, or fragment data.',
    );
  }
  return parsed.href.replace(/\/$/, '');
}
