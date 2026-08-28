import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { BackendContext, InteractionOutcome } from '@msc/conversation';

import { InteractionStore } from '../src/store.js';
import { selectStudyItem, type StudyItem } from '../src/study-plan.js';

const workspace = mkdtempSync(join(tmpdir(), 'msc-store-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

let counter = 0;
function freshStore(): InteractionStore {
  counter += 1;
  return new InteractionStore(join(workspace, `test-${counter}.db`));
}

const context: BackendContext = {
  interactionId: 'demo-001',
  topic: 'linear equations',
  sourceText: 'Solve equations by applying the same operation to both sides.',
  difficulty: 'easy',
  image: null,
};

function completed(): InteractionOutcome {
  return {
    status: 'completed',
    context,
    question: {
      question: 'Solve 2x + 3 = 11.',
      expectedAnswer: '4',
      rubric: 'Correct when x = 4.',
      meta: { agent: 'scripted', promptVersion: 'scripted/2026-08-28.1', model: null },
    },
    reply: {
      provider: 'telegram',
      providerEventId: '1',
      providerMessageId: '2',
      providerConversationId: '555',
      text: 'x = 4',
      receivedAt: new Date().toISOString(),
    },
    evaluation: {
      result: 'correct',
      feedback: 'Correct — subtract 3, then divide by 2.',
      confidence: 1,
      deterministic: true,
      meta: { agent: 'scripted', promptVersion: 'scripted/2026-08-28.1', model: null },
    },
    result: {
      interactionId: 'demo-001',
      question: 'Solve 2x + 3 = 11.',
      studentReply: 'x = 4',
      feedback: 'Correct — subtract 3, then divide by 2.',
      result: 'correct',
    },
    trace: {
      interactionId: 'demo-001',
      conversationId: '555',
      provider: 'telegram',
      questionSentAt: new Date().toISOString(),
      questionMessageId: '99',
      repliedAt: new Date().toISOString(),
      feedbackMessageId: '100',
      agent: 'scripted',
      model: null,
      questionPromptVersion: 'scripted/2026-08-28.1',
      evaluationPromptVersion: 'scripted/2026-08-28.1',
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
  assert.equal(second.wasSent('demo-001:feedback'), true);
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
