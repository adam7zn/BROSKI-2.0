import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseBackendContext,
  parseConversationResult,
} from '../src/contracts.js';

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/contracts',
);

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8'));

test('the Phase 0 context fixture is a valid backend context', () => {
  const context = parseBackendContext(fixture('backend-context.example.json'));
  assert.equal(context.interactionId, 'demo-001');
  assert.equal(context.difficulty, 'easy');
  assert.equal(context.image, null);
});

test('the Phase 0 result fixture is a valid conversation result', () => {
  const result = parseConversationResult(fixture('conversation-result.example.json'));
  assert.equal(result.interactionId, 'demo-001');
  assert.equal(result.result, 'correct');
});

test('an unknown difficulty is rejected rather than passed through', () => {
  assert.throws(() =>
    parseBackendContext({
      interactionId: 'x',
      topic: 't',
      sourceText: 's',
      difficulty: 'brutal',
      image: null,
    }),
  );
});

test('a missing field is rejected', () => {
  assert.throws(() =>
    parseConversationResult({
      interactionId: 'x',
      question: 'q',
      studentReply: 'r',
      result: 'correct',
    }),
  );
});
