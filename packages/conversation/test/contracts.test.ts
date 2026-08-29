import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  normaliseDifficulty,
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
  const result = parseConversationResult(
    fixture('conversation-result.example.json'),
  );
  assert.equal(result.interactionId, 'demo-001');
  assert.equal(result.result, 'correct');
});

test('an unknown difficulty is read as medium rather than as the easiest', () => {
  // The wire contract accepts any string, so the agent normalises at the point
  // of use instead of failing a payload the API considers valid.
  const context = parseBackendContext({
    interactionId: 'x',
    topic: 't',
    sourceText: 's',
    difficulty: 'brutal',
    image: null,
  });
  assert.equal(context.difficulty, 'brutal');
  assert.equal(normaliseDifficulty(context.difficulty), 'medium');
  assert.equal(normaliseDifficulty(' Hard '), 'hard');
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
