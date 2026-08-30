import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';

import type { VerifiedExerciseContext } from '@math-study-companion/contracts';
import {
  ClaudeConversationAgent,
  DeterministicDemoAgent,
  SendblueError,
  type ConversationAgent,
  type MessagingProvider,
  type OutboundImage,
  type OutboundText,
  type SendResult,
} from '@math-study-companion/conversation';

import { createDemoApp } from '../src/app.js';
import { InMemoryExerciseCatalogRepository } from '../src/exercise-repository.js';
import { stableIdempotencyKey } from '../src/hosted-messaging.js';
import type { Logger } from '../src/logger.js';
import { InMemoryHostedMessagingRepository } from '../src/messaging-repository.js';
import { InMemoryDemoInteractionRepository } from '../src/repository.js';

const participant = '+46700000000';
const line = '+13470000000';
const webhookSecret = 'webhook-test-secret';
const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()));
});

test('runs launch -> Sendblue webhook replies -> agent -> persisted result', async () => {
  const fixture = await createFixture();
  await fixture.launch();
  assert.equal(fixture.provider.sent.length, 1);
  assert.match(fixture.provider.sent[0]?.text ?? '', /Which maths course/);

  assert.equal(
    (await fixture.reply('Mathematics 3c', 'in-1')).outcome,
    'queued',
  );
  assert.match(
    fixture.provider.sent[1]?.text ?? '',
    /struggling, okay, or confident/,
  );
  await fixture.reply('okay', 'in-2');
  assert.match(fixture.provider.sent[2]?.text ?? '', /grade/);
  await fixture.reply('SKIP', 'in-3');
  assert.equal(fixture.provider.sent.length, 5);
  assert.match(fixture.provider.sent[4]?.text ?? '', /Solve 2x \+ 3 = 11/);
  await fixture.reply('8/2', 'in-4');

  const interaction = await fixture.app.service.get('demo-001', 'request');
  assert.equal(interaction.result?.result, 'correct');
  const profile = await fixture.app.service.getProfile('request');
  assert.equal(profile.previousGrade, null);
  assert.equal(fixture.provider.sent.length, 6);
  const inspected = await fixture.app.messaging!.inspect('demo-001', 'request');
  assert.equal(JSON.stringify(inspected).includes('Mathematics 3c'), false);
  assert.equal(JSON.stringify(inspected).includes('8/2'), false);
  assert.equal(JSON.stringify(inspected).includes(participant), false);
  assert.equal(JSON.stringify(inspected).includes(line), false);
  assert.equal(inspected.session?.status, 'completed');

  const originalResult = interaction.result;
  await fixture.reply('Why does that work?', 'in-5');
  const afterFollowUp = await fixture.app.service.get('demo-001', 'request');
  const followedUp = await fixture.app.messaging!.inspect(
    'demo-001',
    'request',
  );
  assert.deepEqual(afterFollowUp.result, originalResult);
  assert.equal(followedUp.session?.status, 'completed');
  assert.equal(followedUp.session?.turnNumber, 5);
  assert.equal(fixture.provider.sent.length, 7);
  assert.match(fixture.provider.sent[6]?.text ?? '', /exercise is complete/i);
});

test('launches the manually selected verified prompt unchanged through the durable outbox', async () => {
  const exercise = syntheticVerifiedExercise();
  const fixture = await createFixture({
    interactionId: 'verified-exercise-run',
    exercise,
    agent: new ClaudeConversationAgent({
      studyAgent: {
        askQuestion: async () => {
          throw new Error('Claude must not invent the selected question.');
        },
        respond: async () => {
          throw new Error('No inbound turn is expected in this test.');
        },
      },
    }),
  });
  await fixture.app.service.saveProfile(
    {
      course: 'Mathematics 3c',
      selfAssessedLevel: 'okay',
      previousGrade: null,
    },
    'trace-1',
  );

  await fixture.launch();

  assert.equal(fixture.provider.sent[0]?.text, exercise.prompt);
  assert.equal(
    (await fixture.app.service.get('verified-exercise-run', 'request'))
      .exerciseId,
    exercise.exerciseId,
  );
});

test('deduplicates inbound handles and filters wrong, group, and old events', async () => {
  const fixture = await createFixture();
  await fixture.launch();
  const wrong = await fixture.app.messaging!.ingestWebhook(
    inboundPayload('wrong', 'wrong-1', fixture.nextTime(), '+46799999999'),
    webhookSecret,
    'trace-webhook',
  );
  assert.deepEqual(wrong, { outcome: 'ignored', reason: 'not-allowlisted' });

  const wrongLine = await fixture.app.messaging!.ingestWebhook(
    {
      ...inboundPayload('wrong line', 'wrong-line-1', fixture.nextTime()),
      to_number: '+13479999999',
      sendblue_number: '+13479999999',
    },
    webhookSecret,
    'trace-webhook',
  );
  assert.deepEqual(wrongLine, {
    outcome: 'ignored',
    reason: 'not-allowlisted',
  });

  const selfAuthored = await fixture.app.messaging!.ingestWebhook(
    outboundPayload('SENT', 'unknown-self-authored', fixture.nextTime()),
    webhookSecret,
    'trace-webhook',
  );
  assert.deepEqual(selfAuthored, {
    outcome: 'ignored',
    reason: 'unknown-outbound-message',
  });

  const group = await fixture.app.messaging!.ingestWebhook(
    {
      ...inboundPayload('group', 'group-1', fixture.nextTime()),
      group_id: 'g',
    },
    webhookSecret,
    'trace-webhook',
  );
  assert.deepEqual(group, { outcome: 'ignored', reason: 'group-message' });

  const session = await fixture.repository.findSession('demo-001');
  const old = await fixture.app.messaging!.ingestWebhook(
    inboundPayload('old', 'old-1', session!.lastPromptAt!),
    webhookSecret,
    'trace-webhook',
  );
  assert.deepEqual(old, {
    outcome: 'ignored',
    reason: 'pre_prompt_message',
  });
  assert.equal(
    (await fixture.repository.findSession('demo-001'))?.status,
    'active',
  );

  const first = await fixture.app.messaging!.ingestWebhook(
    inboundPayload('Mathematics 3c', 'same-1', fixture.nextTime()),
    webhookSecret,
    'trace-webhook',
  );
  const duplicate = await fixture.app.messaging!.ingestWebhook(
    inboundPayload('Mathematics 3c', 'same-1', fixture.currentTime()),
    webhookSecret,
    'trace-webhook',
  );
  assert.equal(first.outcome, 'queued');
  assert.equal(duplicate.outcome, 'duplicate');
});

test('processes only one reply for each prompt turn', async () => {
  const fixture = await createFixture();
  await fixture.launch();
  await fixture.app.messaging!.ingestWebhook(
    inboundPayload('Mathematics 3c', 'rapid-1', fixture.nextTime()),
    webhookSecret,
    'trace-webhook',
  );
  await fixture.app.messaging!.ingestWebhook(
    inboundPayload('duplicate reply', 'rapid-2', fixture.nextTime()),
    webhookSecret,
    'trace-webhook',
  );

  await fixture.app.messagingWorker!.processAvailable();

  assert.equal(fixture.provider.sent.length, 2);
  const inbox = await fixture.repository.listInbound('demo-001');
  assert.equal(inbox[0]?.processingStatus, 'processed');
  assert.equal(inbox[1]?.processingStatus, 'failed');
  assert.equal(inbox[1]?.errorCode, 'STALE_INBOUND_TURN');
});

test('fails closed on opt-out and SMS downgrade webhooks', async () => {
  const optedOut = await createFixture();
  await optedOut.launch();
  await optedOut.app.messaging!.ingestWebhook(
    {
      ...inboundPayload('STOP', 'stop-1', optedOut.nextTime()),
      opted_out: true,
    },
    webhookSecret,
    'trace-webhook',
  );
  assert.equal(
    (await optedOut.repository.findSession('demo-001'))?.status,
    'stopped',
  );

  const downgraded = await createFixture({ interactionId: 'demo-sms' });
  await downgraded.launch();
  await downgraded.app.messaging!.ingestWebhook(
    {
      ...inboundPayload('reply', 'sms-1', downgraded.nextTime()),
      service: 'SMS',
      was_downgraded: true,
    },
    webhookSecret,
    'trace-webhook',
  );
  assert.equal(
    (await downgraded.repository.findSession('demo-sms'))?.status,
    'failed',
  );
  assert.equal(
    (await downgraded.repository.findSession('demo-sms'))?.failureCode,
    'SENDBLUE_SMS_DOWNGRADE',
  );

  const outboundDowngrade = await createFixture({
    interactionId: 'demo-outbound-sms',
  });
  await outboundDowngrade.launch();
  await outboundDowngrade.app.messaging!.ingestWebhook(
    {
      ...outboundPayload('QUEUED', 'out-1', outboundDowngrade.nextTime()),
      service: 'SMS',
      was_downgraded: true,
    },
    webhookSecret,
    'trace-webhook',
  );
  assert.equal(
    (await outboundDowngrade.repository.findSession('demo-outbound-sms'))
      ?.failureCode,
    'SENDBLUE_SMS_DOWNGRADE',
  );
});

test('records delivery statuses without regressing and deduplicates callbacks', async () => {
  const fixture = await createFixture();
  await fixture.launch();
  const deliveredAt = fixture.nextTime();
  const delivered = outboundPayload('DELIVERED', 'out-1', deliveredAt);
  assert.equal(
    (
      await fixture.app.messaging!.ingestWebhook(
        delivered,
        webhookSecret,
        'trace-delivery',
      )
    ).outcome,
    'recorded',
  );
  assert.equal(
    (
      await fixture.app.messaging!.ingestWebhook(
        delivered,
        webhookSecret,
        'trace-delivery',
      )
    ).outcome,
    'duplicate',
  );
  await fixture.app.messaging!.ingestWebhook(
    outboundPayload('SENT', 'out-1', fixture.nextTime()),
    webhookSecret,
    'trace-delivery',
  );
  assert.equal(
    (await fixture.repository.listOutbox('demo-001'))[0]?.deliveryStatus,
    'delivered',
  );
});

test('requires bearer auth for internal routes and separate webhook auth', async () => {
  const interactionRepository = new InMemoryDemoInteractionRepository();
  const messagingRepository = new InMemoryHostedMessagingRepository(
    interactionRepository,
  );
  const preflightAgent = Object.assign(new DeterministicDemoAgent(), {
    verifyProvider: async () => ({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    }),
  });
  const app = await createDemoApp({
    repository: interactionRepository,
    internalApiToken: 'internal-test-token',
    messaging: {
      repository: messagingRepository,
      provider: new CapturingProvider(() => new Date()),
      agent: preflightAgent,
      webhookSecret,
      participantAddress: participant,
      providerLine: line,
      liveEnabled: false,
    },
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, '127.0.0.1', resolve),
  );
  const address = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  servers.push(
    () => new Promise<void>((resolve) => app.server.close(() => resolve())),
  );

  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  assert.equal(
    (await fetch(`${baseUrl}/internal/demo/start`, { method: 'POST' })).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/internal/demo/start`, {
        method: 'POST',
        headers: { authorization: 'Bearer internal-test-token' },
      })
    ).status,
    201,
  );
  const messagingStatus = await fetch(
    `${baseUrl}/internal/messaging/status?verifyProvider=true`,
    { headers: { authorization: 'Bearer internal-test-token' } },
  );
  assert.equal(messagingStatus.status, 200);
  const messagingStatusBody = await messagingStatus.json();
  assert.equal(messagingStatusBody.provider, 'sendblue');
  assert.equal(messagingStatusBody.liveEnabled, false);
  assert.equal(messagingStatusBody.availability.service, 'iMessage');
  assert.ok(Date.parse(messagingStatusBody.availability.checkedAt));
  const agentStatus = await fetch(
    `${baseUrl}/internal/messaging/status?verifyAgent=true`,
    { headers: { authorization: 'Bearer internal-test-token' } },
  );
  assert.equal(agentStatus.status, 200);
  assert.deepEqual((await agentStatus.json()).agentAvailability, {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  });
  assert.equal(
    (
      await fetch(`${baseUrl}/internal/messaging/status?verifyAgent=maybe`, {
        headers: { authorization: 'Bearer internal-test-token' },
      })
    ).status,
    400,
  );
  const invalidWebhook = await fetch(`${baseUrl}/webhooks/messaging/sendblue`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sb-signing-secret': 'wrong',
    },
    body: JSON.stringify(
      inboundPayload('secret body', 'bad-1', new Date().toISOString()),
    ),
  });
  assert.equal(invalidWebhook.status, 401);
  assert.equal(
    (await invalidWebhook.json()).code,
    'INVALID_WEBHOOK_AUTHENTICATION',
  );
});

test('reserves before provider invocation and never resends a duplicate reservation', async () => {
  const fixture = await createFixture({ autoLaunch: false });
  await fixture.app.messaging!.launch('demo-001', 'trace-1');
  const key = stableIdempotencyKey('demo-001', 0, 0);
  await fixture.app.service.reserveOutbound(
    'demo-001',
    { idempotencyKey: key },
    'trace-1',
  );
  await fixture.app.messagingWorker!.processAvailable();
  assert.equal(fixture.provider.sent.length, 0);
  assert.equal(
    (await fixture.repository.listOutbox('demo-001'))[0]?.deliveryStatus,
    'uncertain',
  );
});

for (const [error, expected] of [
  [new SendblueError('authentication', false, 'known failure'), 'failed'],
  [new SendblueError('timeout', true, 'unknown delivery'), 'uncertain'],
] as const) {
  test(`persists provider ${expected} state without retrying`, async () => {
    const provider = new CapturingProvider(() => new Date(), error);
    const fixture = await createFixture({ provider, autoLaunch: false });
    await fixture.app.messaging!.launch('demo-001', 'trace-1');
    await fixture.app.messagingWorker!.processAvailable();
    const outbox = await fixture.repository.listOutbox('demo-001');
    assert.equal(outbox[0]?.deliveryStatus, expected);
    assert.equal(provider.attempts, 1);
    await fixture.app.messagingWorker!.processAvailable();
    assert.equal(provider.attempts, 1);
  });
}

test('rejects runtime-invalid agent output and keeps message bodies out of logs', async () => {
  const logs: unknown[] = [];
  const brokenAgent: ConversationAgent = {
    startSession: async () => ({ invalid: true }) as never,
    handleInbound: async () => ({ invalid: true }) as never,
  };
  const fixture = await createFixture({
    agent: brokenAgent,
    autoLaunch: false,
    logger: { write: (entry) => logs.push(entry) },
  });
  await assert.rejects(
    fixture.app.messaging!.launch('demo-001', 'trace-1'),
    /agent output failed validation/i,
  );
  assert.equal(JSON.stringify(logs).includes('private reply'), false);
});

test('rejects a validly shaped agent result for a different interaction', async () => {
  const agent: ConversationAgent = {
    startSession: async () => ({
      outbound: [
        { purpose: 'question', text: 'Solve 2x + 3 = 11.', mediaUrl: null },
      ],
      agentState: { step: 'answer' },
      profile: null,
      result: null,
      status: 'waiting',
    }),
    handleInbound: async () => ({
      outbound: [
        {
          purpose: 'feedback',
          text: 'Correct — subtract 3, then divide by 2.',
          mediaUrl: null,
        },
      ],
      agentState: { step: 'complete' },
      profile: null,
      result: {
        interactionId: 'different-interaction',
        question: 'Solve 2x + 3 = 11.',
        studentReply: 'x = 4',
        feedback: 'Correct — subtract 3, then divide by 2.',
        result: 'correct',
      },
      status: 'completed',
    }),
  };
  const fixture = await createFixture({ agent });
  await fixture.launch();
  await fixture.reply('x = 4', 'mismatched-agent-result');

  assert.equal(
    (await fixture.app.service.get('demo-001', 'request')).result,
    null,
  );
  assert.equal(
    (await fixture.repository.findSession('demo-001'))?.failureCode,
    'AGENT_PROCESSING_FAILED',
  );
  assert.equal(fixture.provider.sent.length, 1);
});

test('persists the attempt before a feedback delivery failure', async () => {
  let clock = new Date('2026-08-29T12:00:00.000Z');
  const provider = new CapturingProvider(
    () => new Date(clock),
    new SendblueError('rejected', false, 'simulated feedback rejection'),
    2,
  );
  const fixture = await createFixture({ provider });
  await fixture.app.service.saveProfile(
    {
      course: 'Mathematics 3c',
      selfAssessedLevel: 'okay',
      previousGrade: null,
    },
    'trace-1',
  );
  await fixture.launch();
  clock = new Date(clock.getTime() + 1_000);
  await fixture.reply('x = 4', 'answer-before-feedback-failure');

  assert.equal(
    (await fixture.app.service.get('demo-001', 'request')).result?.result,
    'correct',
  );
  const outbox = await fixture.repository.listOutbox('demo-001');
  assert.equal(
    outbox.find(({ purpose }) => purpose === 'feedback')?.deliveryStatus,
    'failed',
  );
});

test('preserves a previously accepted result and does not queue later feedback', async () => {
  const fixture = await createFixture();
  await fixture.app.service.saveProfile(
    {
      course: 'Mathematics 3c',
      selfAssessedLevel: 'okay',
      previousGrade: null,
    },
    'trace-1',
  );
  await fixture.launch();
  await fixture.app.service.submitResult(
    'demo-001',
    {
      interactionId: 'demo-001',
      question: 'Solve 2x + 3 = 11.',
      studentReply: 'x = 4',
      feedback: 'First accepted feedback.',
      result: 'correct',
    },
    'trace-1',
  );
  await fixture.reply('x = 3', 'late-reply-after-completion');

  const stored = await fixture.app.service.get('demo-001', 'request');
  assert.equal(stored.result?.feedback, 'First accepted feedback.');
  assert.equal(fixture.provider.sent.length, 1);
  assert.equal(
    (await fixture.repository.findSession('demo-001'))?.failureCode,
    'INTERACTION_ALREADY_COMPLETED',
  );
});

test('fails the claimed inbox row when the migrated agent throws', async () => {
  const delegate = new DeterministicDemoAgent();
  const logs: unknown[] = [];
  const agent: ConversationAgent = {
    startSession: (input) => delegate.startSession(input),
    handleInbound: async () => {
      throw new Error('partner agent failed on private reply');
    },
  };
  const fixture = await createFixture({
    agent,
    logger: { write: (entry) => logs.push(entry) },
  });
  await fixture.launch();
  await fixture.reply('private reply', 'agent-failure-1');
  assert.equal(
    (await fixture.repository.findSession('demo-001'))?.status,
    'failed',
  );
  assert.equal(
    (await fixture.repository.listInbound('demo-001'))[0]?.processingStatus,
    'failed',
  );
  assert.equal(JSON.stringify(logs).includes('private reply'), false);
});

test('derives stable keys from session position rather than agent wording', () => {
  assert.equal(
    stableIdempotencyKey('demo-001', 3, 1),
    'demo-001:turn:3:intent:01',
  );
});

interface FixtureOptions {
  interactionId?: string;
  exercise?: VerifiedExerciseContext;
  provider?: CapturingProvider;
  agent?: ConversationAgent;
  autoLaunch?: boolean;
  logger?: Logger;
}

async function createFixture(options: FixtureOptions = {}) {
  let clock = new Date('2026-08-29T12:00:00.000Z');
  const now = () => new Date(clock);
  const interactionId = options.interactionId ?? 'demo-001';
  const interactionRepository = new InMemoryDemoInteractionRepository();
  const repository = new InMemoryHostedMessagingRepository(
    interactionRepository,
  );
  const exerciseRepository = new InMemoryExerciseCatalogRepository(
    options.exercise ? [options.exercise] : [],
  );
  const provider = options.provider ?? new CapturingProvider(now);
  const app = await createDemoApp({
    repository: interactionRepository,
    exerciseRepository,
    contextFixture: {
      interactionId,
      topic: 'linear equations',
      sourceText:
        'Solve equations by applying the same operation to both sides.',
      difficulty: 'easy',
      image: null,
      mode: 'PRACTISE',
      reason: 'Manual judge MVP demonstration',
    },
    now,
    ...(options.logger ? { logger: options.logger } : {}),
    messaging: {
      repository,
      provider,
      agent: options.agent ?? new DeterministicDemoAgent(),
      webhookSecret,
      participantAddress: participant,
      providerLine: line,
      liveEnabled: true,
      now,
      ...(options.logger ? { logger: options.logger } : {}),
    },
  });
  if (options.exercise) {
    await app.service.startExercise(
      options.exercise.exerciseId,
      'trace-1',
      interactionId,
    );
  } else {
    await app.service.start('trace-1', interactionId);
  }

  const fixture = {
    app,
    repository,
    provider,
    launch: async () => {
      await app.messaging!.launch(interactionId, 'trace-1');
      await app.messagingWorker!.processAvailable();
    },
    nextTime: () => {
      clock = new Date(clock.getTime() + 1_000);
      return clock.toISOString();
    },
    currentTime: () => clock.toISOString(),
    reply: async (text: string, handle: string) => {
      clock = new Date(clock.getTime() + 1_000);
      const result = await app.messaging!.ingestWebhook(
        inboundPayload(text, handle, clock.toISOString()),
        webhookSecret,
        'trace-webhook',
      );
      await app.messagingWorker!.processAvailable();
      return result;
    },
  };
  if (options.autoLaunch === true) await fixture.launch();
  return fixture;
}

function syntheticVerifiedExercise(): VerifiedExerciseContext {
  return {
    exerciseId: '11111111-1111-4111-8111-111111111111',
    sourceDocumentId: '22222222-2222-4222-8222-222222222222',
    sourcePageId: '33333333-3333-4333-8333-333333333333',
    sourceBlockId: '44444444-4444-4444-8444-444444444444',
    sourceBoundingBox: [0.1, 0.2, 0.7, 0.1],
    printedPageNumber: '13',
    sectionCode: '1.1',
    sectionTitle: 'Synthetic Polynomials',
    exerciseNumber: 'S-101',
    partLabel: 'a',
    topic: 'Synthetic factorisation',
    prompt: 'Factor x^2 - 9.',
    answerPayload: { canonical: '(x-3)(x+3)', accepted: [] },
    solutionText: 'Use the difference of two squares.',
    rubric: 'Accept an algebraically equivalent complete factorisation.',
    difficulty: 'medium',
    gradingStrategy: 'symbolic',
    contentChecksum: 'a'.repeat(64),
    verificationState: 'verified',
    verifiedBy: 'test-reviewer',
    verifiedAt: '2026-08-30T08:00:00.000Z',
  };
}

class CapturingProvider implements MessagingProvider {
  readonly name = 'sendblue';
  readonly sent: Array<{ text: string; key: string }> = [];
  attempts = 0;

  constructor(
    private readonly now: () => Date,
    private readonly failure?: Error,
    private readonly failOnAttempt = 1,
  ) {}

  sendMessage(input: OutboundText): Promise<SendResult> {
    return this.send(input.text, input.idempotencyKey);
  }

  sendImage(input: OutboundImage): Promise<SendResult> {
    return this.send(input.caption ?? input.altText, input.idempotencyKey);
  }

  async checkServiceAvailability() {
    return {
      service: 'iMessage' as const,
      checkedAt: this.now().toISOString(),
    };
  }

  async send(text: string, key: string): Promise<SendResult> {
    this.attempts += 1;
    if (this.failure && this.attempts === this.failOnAttempt) {
      throw this.failure;
    }
    this.sent.push({ text, key });
    return {
      providerMessageId: `out-${this.sent.length}`,
      acceptedAt: this.now().toISOString(),
      deduplicated: false,
    };
  }
}

function inboundPayload(
  content: string,
  messageHandle: string,
  date: string,
  fromNumber = participant,
) {
  return {
    content,
    is_outbound: false,
    status: 'RECEIVED',
    message_handle: messageHandle,
    date_sent: date,
    from_number: fromNumber,
    to_number: line,
    sendblue_number: line,
    group_id: '',
    opted_out: false,
    was_downgraded: false,
    service: 'iMessage',
  };
}

function outboundPayload(status: string, messageHandle: string, date: string) {
  return {
    content: 'body must not be logged',
    is_outbound: true,
    status,
    message_handle: messageHandle,
    date_sent: date,
    date_updated: date,
    from_number: line,
    number: participant,
    to_number: participant,
    group_id: '',
    was_downgraded: false,
    service: 'iMessage',
  };
}
