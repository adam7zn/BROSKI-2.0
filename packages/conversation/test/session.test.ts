import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ScriptedStudyAgent } from '../src/agent/scripted-agent.js';
import type { EvaluateInput, GeneratedQuestion, StudyAgent } from '../src/agent/types.js';
import type { BackendContext } from '../src/contracts.js';
import { ReplyInbox } from '../src/inbox.js';
import { FakeMessagingProvider } from '../src/messaging/fake.js';
import { runInteraction } from '../src/session.js';

const CONVERSATION = 'chat-1';

function context(overrides: Partial<BackendContext> = {}): BackendContext {
  return {
    interactionId: 'demo-001',
    topic: 'linear equations',
    sourceText: 'Solve equations by applying the same operation to both sides.',
    difficulty: 'easy',
    image: null,
    ...overrides,
  };
}

function harness() {
  const messaging = new FakeMessagingProvider();
  const inbox = new ReplyInbox();
  const controller = new AbortController();
  void inbox.pump(messaging, controller.signal);
  return { messaging, inbox, stop: () => controller.abort() };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSent(messaging: FakeMessagingProvider, count: number) {
  while (messaging.sent.length < count) await sleep(5);
  return messaging.sent[count - 1]!;
}

test('a correct reply produces feedback and a valid result payload', async () => {
  const { messaging, inbox, stop } = harness();
  const agent = new ScriptedStudyAgent();
  const question = await agent.askQuestion(context());

  const run = runInteraction({
    context: context(),
    conversationId: CONVERSATION,
    agent,
    messaging,
    inbox,
    replyTimeoutMs: 2000,
  });

  await waitForSent(messaging, 1);
  messaging.deliver(CONVERSATION, `x = ${question.expectedAnswer}`);

  const outcome = await run;
  assert.equal(outcome.status, 'completed');
  if (outcome.status !== 'completed') return;

  assert.equal(outcome.result.result, 'correct');
  assert.equal(outcome.result.interactionId, 'demo-001');
  assert.equal(outcome.result.question, outcome.question.question);
  assert.equal(outcome.evaluation.deterministic, true);

  // Question out, feedback back — exactly two messages.
  assert.equal(messaging.sent.length, 2);
  assert.equal(messaging.sent[1]!.text, outcome.result.feedback);
  assert.equal(outcome.trace.evaluationPromptVersion, 'scripted/2026-08-28.1');
  stop();
});

test('an unreadable reply is unclear, not wrong', async () => {
  const { messaging, inbox, stop } = harness();

  const run = runInteraction({
    context: context(),
    conversationId: CONVERSATION,
    agent: new ScriptedStudyAgent(),
    messaging,
    inbox,
    replyTimeoutMs: 2000,
  });

  await waitForSent(messaging, 1);
  messaging.deliver(CONVERSATION, 'vet inte typ');

  const outcome = await run;
  assert.equal(outcome.status, 'completed');
  if (outcome.status !== 'completed') return;
  assert.equal(outcome.result.result, 'unclear');
  stop();
});

test('silence stores no attempt', async () => {
  const { messaging, inbox, stop } = harness();

  const outcome = await runInteraction({
    context: context(),
    conversationId: CONVERSATION,
    agent: new ScriptedStudyAgent(),
    messaging,
    inbox,
    replyTimeoutMs: 30,
  });

  assert.equal(outcome.status, 'no_reply');
  assert.equal(messaging.sent.length, 1);
  stop();
});

test('a message sent before the question is not treated as its answer', async () => {
  const { messaging, inbox, stop } = harness();
  const agent = new ScriptedStudyAgent();
  const question = await agent.askQuestion(context());

  messaging.deliver(CONVERSATION, 'hej!');
  await sleep(5);

  const run = runInteraction({
    context: context(),
    conversationId: CONVERSATION,
    agent,
    messaging,
    inbox,
    replyTimeoutMs: 2000,
  });

  await waitForSent(messaging, 1);
  await sleep(5);
  messaging.deliver(CONVERSATION, String(question.expectedAnswer));

  const outcome = await run;
  assert.equal(outcome.status, 'completed');
  if (outcome.status !== 'completed') return;
  assert.equal(outcome.reply.text, String(question.expectedAnswer));
  stop();
});

test('the same provider event is only processed once', () => {
  const inbox = new ReplyInbox();
  const event = {
    provider: 'telegram',
    providerEventId: '42',
    providerMessageId: '7',
    providerConversationId: CONVERSATION,
    text: '4',
    receivedAt: new Date().toISOString(),
  };
  assert.equal(inbox.push(event), true);
  assert.equal(inbox.push({ ...event }), false);
});

test('re-sending the same idempotency key does not send twice', async () => {
  const messaging = new FakeMessagingProvider();
  const first = await messaging.sendMessage({
    conversationId: CONVERSATION,
    text: 'Solve 2x + 3 = 11.',
    idempotencyKey: 'demo-001:question',
  });
  const second = await messaging.sendMessage({
    conversationId: CONVERSATION,
    text: 'Solve 2x + 3 = 11.',
    idempotencyKey: 'demo-001:question',
  });

  assert.equal(messaging.sent.length, 1);
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(second.providerMessageId, first.providerMessageId);
});

test('a context with an image sends the question as the caption', async () => {
  const { messaging, inbox, stop } = harness();
  const agent = new ScriptedStudyAgent();

  const run = runInteraction({
    context: context({ image: 'https://example.com/graph.png' }),
    conversationId: CONVERSATION,
    agent,
    messaging,
    inbox,
    replyTimeoutMs: 30,
  });

  const sent = await waitForSent(messaging, 1);
  assert.equal(sent.kind, 'image');
  await run;
  stop();
});

test('an agent failure never leaves a half-sent interaction', async () => {
  const { messaging, inbox, stop } = harness();
  const failing: StudyAgent = {
    async askQuestion(): Promise<GeneratedQuestion> {
      throw new Error('model unavailable');
    },
    async evaluate(_input: EvaluateInput) {
      throw new Error('unreachable');
    },
  };

  await assert.rejects(
    runInteraction({
      context: context(),
      conversationId: CONVERSATION,
      agent: failing,
      messaging,
      inbox,
      replyTimeoutMs: 30,
    }),
    /model unavailable/,
  );
  assert.equal(messaging.sent.length, 0);
  stop();
});
