import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkAnswer, normalizeAnswer, toNumber } from '../src/agent/answer-check.js';

test('normalizes the ways a student types the same answer', () => {
  for (const written of ['4', 'x = 4', 'X=4', ' x = 4. ', 'svaret är 4']) {
    assert.equal(normalizeAnswer(written), '4', written);
  }
});

test('reads a Swedish decimal comma as a decimal point', () => {
  assert.equal(toNumber(normalizeAnswer('4,5')), 4.5);
});

test('keeps a comma-separated list intact', () => {
  assert.equal(normalizeAnswer('2, 3'), '2, 3');
});

test('accepts fractions', () => {
  assert.equal(toNumber('-3/2'), -1.5);
  assert.equal(toNumber('1/0'), null);
});

test('confirms a matching answer however it is written', () => {
  assert.equal(checkAnswer('4', 'x = 4'), 'match');
  assert.equal(checkAnswer('-3/2', '-1,5'), 'match');
});

test('reports a mismatch only when both sides are numbers', () => {
  assert.equal(checkAnswer('4', '5'), 'mismatch');
  assert.equal(checkAnswer('2x + 2', '2(x+1)'), 'unknown');
});

test('has no opinion without an expected answer or a reply', () => {
  assert.equal(checkAnswer(null, '4'), 'unknown');
  assert.equal(checkAnswer('4', '   '), 'unknown');
});
