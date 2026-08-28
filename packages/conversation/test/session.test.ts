import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ScriptedStudyAgent } from '../src/agent/scripted-agent.js';
import type {
  AgentTurn,
  GeneratedQuestion,
  RespondInput,
  StudyAgent,
} from '../src/agent/types.js';
import { backendContextSchema, type BackendContext } from '../src/contracts.js';
import { ReplyInbox } from '../src/inbox.js';
import { FakeMessagingProvider } from '../src/messaging/fake.js';
import { runInteraction } from '../src/session.js';

const CONVERSATION = 'chat-1';

function context(overrides: Partial<BackendContext> = {}): BackendContext {
  return backendContextSchema.parse({
    interactionId: 'demo-001',
    topic: 'linear equations',
    sourceText: 'Solve equations by applying the same operation to both sides.',
    difficulty: 'easy',
    image: null,
    ...overrides,
  });
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

test('a correct answer is judged and closes the conversation', async () => {
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
  assert.equal(outcome.final.deterministic, true);
  assert.equal(messaging.sent.length, 2);
  assert.equal(outcome.trace.studentTurns, 1);
  assert.equal(outcome.trace.hintsGiven, 0);
  stop();
});

test('asking for a hint keeps the conversation open, then it can be answered', async () => {
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
    followUpTimeoutMs: 2000,
  });

  await waitForSent(messaging, 1);
  await sleep(5);
  messaging.deliver(CONVERSATION, 'vet inte, kan jag få en ledtråd?');

  // The hint goes out and the interaction stays open.
  const hint = await waitForSent(messaging, 2);
  assert.match(hint.text, /both sides/);
  await sleep(5);
  messaging.deliver(CONVERSATION, String(question.expectedAnswer));

  const outcome = await run;
  assert.equal(outcome.status, 'completed');
  if (outcome.status !== 'completed') return;

  assert.equal(outcome.result.result, 'correct');
  assert.equal(outcome.trace.hintsGiven, 1);
  assert.equal(outcome.trace.studentTurns, 2);
  // The stored reply is the answer, not the hint request.
  assert.equal(outcome.result.studentReply, String(question.expectedAnswer));
  stop();
});

test('a hint request is never stored as an attempt on its own', async () => {
  const { messaging, inbox, stop } = harness();

  const run = runInteraction({
    context: context(),
    conversationId: CONVERSATION,
    agent: new ScriptedStudyAgent(),
    messaging,
    inbox,
    replyTimeoutMs: 2000,
    followUpTimeoutMs: 60,
  });

  await waitForSent(messaging, 1);
  await sleep(5);
  messaging.deliver(CONVERSATION, 'hjälp');

  const outcome = await run;
  // He never answered, so there is no verdict to record.
  assert.equal(outcome.status, 'no_reply');
  stop();
});

test('the conversation is wrapped up rather than running forever', async () => {
  const { messaging, inbox, stop } = harness();
  const agent = new ScriptedStudyAgent();

  const run = runInteraction({
    context: context(),
    conversationId: CONVERSATION,
    agent,
    messaging,
    inbox,
    replyTimeoutMs: 2000,
    followUpTimeoutMs: 2000,
    maxStudentTurns: 3,
  });

  for (let turn = 0; turn < 3; turn += 1) {
    await waitForSent(messaging, turn + 1);
    await sleep(5);
    messaging.deliver(CONVERSATION, 'öhh');
  }

  const outcome = await run;
  assert.equal(outcome.status, 'completed');
  if (outcome.status !== 'completed') return;
  assert.equal(outcome.result.result, 'unclear');
  assert.equal(outcome.trace.studentTurns, 3);
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
  assert.equal(outcome.result.studentReply, String(question.expectedAnswer));
  stop();
});

test('every turn carries its own idempotency key', async () => {
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
    followUpTimeoutMs: 2000,
  });

  await waitForSent(messaging, 1);
  await sleep(5);
  messaging.deliver(CONVERSATION, 'ledtråd tack');
  await waitForSent(messaging, 2);
  await sleep(5);
  messaging.deliver(CONVERSATION, String(question.expectedAnswer));
  await run;

  const keys = messaging.sent.map((sent) => sent.idempotencyKey);
  assert.deepEqual(keys, [
    'demo-001:question',
    'demo-001:turn-1',
    'demo-001:turn-2',
  ]);
  assert.equal(new Set(keys).size, keys.length);
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
  const send = () =>
    messaging.sendMessage({
      conversationId: CONVERSATION,
      text: 'Solve 2x + 3 = 11.',
      idempotencyKey: 'demo-001:question',
    });

  const first = await send();
  const second = await send();

  assert.equal(messaging.sent.length, 1);
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
});

test('a context with an image sends the question as the caption', async () => {
  const { messaging, inbox, stop } = harness();

  const run = runInteraction({
    context: context({ image: 'https://example.com/graph.png' }),
    conversationId: CONVERSATION,
    agent: new ScriptedStudyAgent(),
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
    async respond(_input: RespondInput): Promise<AgentTurn> {
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

test('two messages sent in quick succession are both read, in order', async () => {
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
    followUpTimeoutMs: 2000,
  });

  await waitForSent(messaging, 1);
  await sleep(5);
  // He fires off both before the hint can possibly reach him.
  messaging.deliver(CONVERSATION, 'vet inte');
  messaging.deliver(CONVERSATION, String(question.expectedAnswer));

  const outcome = await run;
  assert.equal(outcome.status, 'completed');
  if (outcome.status !== 'completed') return;
  assert.equal(outcome.result.result, 'correct');
  assert.equal(outcome.trace.studentTurns, 2);
  assert.equal(outcome.trace.hintsGiven, 1);
  stop();
});
