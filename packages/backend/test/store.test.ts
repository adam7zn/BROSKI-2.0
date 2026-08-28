import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { backendContextSchema, type InteractionOutcome } from '@msc/conversation';

import { InteractionStore } from '../src/store.js';
import { selectStudyItem, type StudyItem } from '../src/study-plan.js';

const workspace = mkdtempSync(join(tmpdir(), 'msc-store-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

let counter = 0;
function freshStore(): InteractionStore {
  counter += 1;
  return new InteractionStore(join(workspace, `test-${counter}.db`));
}

const context = backendContextSchema.parse({
  interactionId: 'demo-001',
  topic: 'linear equations',
  sourceText: 'Solve equations by applying the same operation to both sides.',
  difficulty: 'easy',
  image: null,
  mode: 'REVIEW',
  reason: 'answered correctly 3 days ago, and due for review today',
});

function completed(): InteractionOutcome {
  const now = new Date().toISOString();
  return {
    status: 'completed',
    context,
    question: {
      question: 'Solve 2x + 3 = 11.',
      expectedAnswer: '4',
      rubric: 'Correct when x = 4.',
      meta: { agent: 'scripted', promptVersion: 'scripted/2026-08-28.2', model: null },
    },
    transcript: [
      { role: 'companion', text: 'Solve 2x + 3 = 11.', at: now },
      { role: 'student', text: 'ledtråd?', at: now },
      { role: 'companion', text: 'Take the 3 off both sides first.', at: now },
      { role: 'student', text: 'x = 4', at: now },
      { role: 'companion', text: 'Correct — x = 4.', at: now },
    ],
    final: {
      intent: 'feedback',
      message: 'Correct — x = 4.',
      status: 'resolved',
      result: 'correct',
      confidence: 1,
      deterministic: true,
      meta: { agent: 'scripted', promptVersion: 'scripted/2026-08-28.2', model: null },
    },
    result: {
      interactionId: 'demo-001',
      question: 'Solve 2x + 3 = 11.',
      studentReply: 'x = 4',
      feedback: 'Correct — x = 4.',
      result: 'correct',
    },
    trace: {
      interactionId: 'demo-001',
      conversationId: '555',
      provider: 'telegram',
      mode: 'REVIEW',
      reason: 'answered correctly 3 days ago, and due for review today',
      questionSentAt: now,
      questionMessageId: '99',
      repliedAt: now,
      studentTurns: 2,
      hintsGiven: 1,
      agent: 'scripted',
      model: null,
      questionPromptVersion: 'scripted/2026-08-28.2',
      respondPromptVersion: 'scripted/2026-08-28.2',
      confidence: 1,
      deterministic: true,
    },
  };
}

test('a completed interaction is stored with its attempt', () => {
  const store = freshStore();
  store.planInteraction(context, '555', 'lin-eq-balance');
  store.saveOutcome(completed());

  const [saved] = store.recentInteractions();
  assert.equal(saved?.status, 'answered');
  assert.equal(saved?.question, 'Solve 2x + 3 = 11.');
  assert.equal(saved?.studentReply, 'x = 4');
  assert.equal(saved?.result, 'correct');
  assert.equal(saved?.confidence, 1);
  assert.equal(saved?.mode, 'REVIEW');
  assert.equal(saved?.hintsGiven, 1);
  assert.equal(saved?.studentTurns, 2);
  store.close();
});

test('planning the same interaction twice creates one row', () => {
  const store = freshStore();
  store.planInteraction(context, '555', 'lin-eq-balance');
  store.planInteraction(context, '555', 'lin-eq-balance');
  assert.equal(store.recentInteractions().length, 1);
  store.close();
});

test('the send ledger survives a reopen, so a resumed run cannot re-ask', () => {
  const path = join(workspace, 'ledger.db');
  const first = new InteractionStore(path);
  first.planInteraction(context, '555', 'lin-eq-balance');
  first.saveOutcome(completed());
  first.close();

  const second = new InteractionStore(path);
  assert.equal(second.wasSent('demo-001:question'), true);
  assert.equal(second.wasSent('demo-002:question'), false);
  second.close();
});

test('an unanswered interaction stores no attempt', () => {
  const store = freshStore();
  store.planInteraction(context, '555', 'lin-eq-balance');
  const outcome = completed();
  store.saveOutcome({
    status: 'no_reply',
    context,
    question: outcome.question,
    transcript: outcome.transcript.slice(0, 1),
    trace: outcome.trace,
  });

  const [saved] = store.recentInteractions();
  assert.equal(saved?.status, 'no_reply');
  assert.equal(saved?.result, null);
  assert.equal(saved?.studentReply, null);
  store.close();
});

const plan: StudyItem[] = [
  { id: 'a', topic: 'a', sourceText: 'a', difficulty: 'easy', image: null },
  { id: 'b', topic: 'b', sourceText: 'b', difficulty: 'easy', image: null },
];

test('the attempt history feeds the review scheduler', () => {
  const store = freshStore();
  store.planInteraction(context, '555', 'lin-eq-balance');
  store.saveOutcome(completed());

  const history = store.attemptHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0]?.studyItemId, 'lin-eq-balance');
  assert.equal(history[0]?.result, 'correct');
  store.close();
});

test('an unstudied item is chosen first', () => {
  const selection = selectStudyItem(plan, new Map([['a', '2026-08-28T10:00:00Z']]));
  assert.equal(selection.item.id, 'b');
  assert.equal(selection.reason, 'never studied before');
});

test('otherwise the item studied longest ago is chosen, with a stated reason', () => {
  const lastUsed = new Map([
    ['a', '2026-08-20T10:00:00Z'],
    ['b', '2026-08-27T10:00:00Z'],
  ]);
  const selection = selectStudyItem(plan, lastUsed, new Date('2026-08-28T10:00:00Z'));
  assert.equal(selection.item.id, 'a');
  assert.match(selection.reason, /8 days ago/);
});
