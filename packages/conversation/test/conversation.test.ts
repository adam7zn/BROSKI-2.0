import assert from 'node:assert/strict';
import test from 'node:test';

import type { BackendToConversation } from '@math-study-companion/contracts';

import {
  CANONICAL_FEEDBACK,
  FakeMessagingProvider,
  ReplyInbox,
  runCanonicalInteraction,
  runOnboarding,
} from '../src/index.js';

const context: BackendToConversation = {
  interactionId: 'demo-001',
  topic: 'linear equations',
  sourceText: 'Solve equations by applying the same operation to both sides.',
  difficulty: 'easy',
  image: null,
  mode: 'PRACTISE',
  reason: 'Manual judge MVP demonstration',
};

test('runs short onboarding and the canonical correct interaction', async () => {
  const messaging = new FakeMessagingProvider();
  const inbox = new ReplyInbox();
  const controller = new AbortController();
  const pump = inbox.pump(messaging, controller.signal);

  const onboarding = runOnboarding({
    interactionId: 'demo-001',
    conversationId: 'student',
    messaging,
    inbox,
    timeoutMs: 1_000,
  });
  await deliverAfterSend(messaging, 1, 'student', 'Mathematics 3c');
  await deliverAfterSend(messaging, 2, 'student', 'okay');
  await deliverAfterSend(messaging, 3, 'student', 'C');
  assert.deepEqual(await onboarding, {
    course: 'Mathematics 3c',
    selfAssessedLevel: 'okay',
    previousGrade: 'C',
  });

  const interaction = runCanonicalInteraction({
    context,
    conversationId: 'student',
    messaging,
    inbox,
    timeoutMs: 1_000,
  });
  await deliverAfterSend(messaging, 5, 'student', 'x = 4');
  const result = await interaction;
  assert.equal(result.result, 'correct');
  assert.equal(result.feedback, CANONICAL_FEEDBACK);
  assert.equal(messaging.sent.length, 6);

  controller.abort();
  await pump;
});

for (const [reply, expected] of [
  ['x = 3', 'incorrect'],
  ['I am not sure', 'unclear'],
] as const) {
  test(`classifies ${reply} without a model`, async () => {
    const messaging = new FakeMessagingProvider();
    const inbox = new ReplyInbox();
    const controller = new AbortController();
    const pump = inbox.pump(messaging, controller.signal);
    const interaction = runCanonicalInteraction({
      context,
      conversationId: 'student',
      messaging,
      inbox,
      timeoutMs: 1_000,
    });
    await deliverAfterSend(messaging, 1, 'student', reply);
    assert.equal((await interaction).result, expected);
    controller.abort();
    await pump;
  });
}

test('times out without creating a result', async () => {
  const messaging = new FakeMessagingProvider();
  const inbox = new ReplyInbox();
  await assert.rejects(
    runCanonicalInteraction({
      context,
      conversationId: 'student',
      messaging,
      inbox,
      timeoutMs: 5,
    }),
    /Timed out/,
  );
});

test('aborts cleanly while waiting for a reply', async () => {
  const messaging = new FakeMessagingProvider();
  const inbox = new ReplyInbox();
  const controller = new AbortController();
  const interaction = runCanonicalInteraction({
    context,
    conversationId: 'student',
    messaging,
    inbox,
    timeoutMs: 1_000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(interaction, /aborted/);
});

async function deliverAfterSend(
  messaging: FakeMessagingProvider,
  count: number,
  conversationId: string,
  text: string,
): Promise<void> {
  while (messaging.sent.length < count) await new Promise(setImmediate);
  messaging.deliver(conversationId, text);
}
