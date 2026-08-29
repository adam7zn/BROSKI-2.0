import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IMessageCliProvider,
  type IMessageCommandRunner,
} from '../src/index.js';

class StubRunner implements IMessageCommandRunner {
  readonly calls: string[][] = [];
  constructor(private readonly outputs: string[]) {}

  async run(args: string[]): Promise<{ stdout: string }> {
    this.calls.push(args);
    const stdout = this.outputs.shift();
    if (stdout === undefined) throw new Error('No stub output');
    return { stdout };
  }
}

class FailingRunner implements IMessageCommandRunner {
  constructor(private readonly error: Error) {}

  async run(): Promise<{ stdout: string }> {
    throw this.error;
  }
}

test('passes message text as one process argument and parses the send result', async () => {
  const runner = new StubRunner([
    JSON.stringify([
      {
        id: 'out-1',
        timestamp: 1_788_000_000_000,
        text: 'hello $(whoami)',
        isSender: true,
        senderID: 'me',
        threadID: 'iMessage;-;+46700000000',
      },
    ]),
  ]);
  const provider = new IMessageCliProvider({
    recipient: '+46700000000',
    commandRunner: runner,
  });
  const result = await provider.sendMessage({
    conversationId: '+46700000000',
    text: 'hello $(whoami)',
    idempotencyKey: 'one',
  });

  assert.deepEqual(runner.calls[0], [
    '--json',
    'send',
    '+46700000000',
    'hello $(whoami)',
  ]);
  assert.equal(result.providerMessageId, 'out-1');
});

test('sends a static local image with argument arrays', async () => {
  const runner = new StubRunner([
    JSON.stringify(true),
    JSON.stringify([
      message(
        'caption-1',
        Date.now(),
        true,
        '+46700000000',
        'Solve 2x + 3 = 11.',
      ),
    ]),
  ]);
  const provider = new IMessageCliProvider({
    recipient: '+46700000000',
    commandRunner: runner,
  });

  await provider.sendImage({
    conversationId: '+46700000000',
    mediaPath: '/tmp/static demo.png',
    altText: 'linear equation',
    caption: 'Solve 2x + 3 = 11.',
    idempotencyKey: 'image-1',
  });

  assert.deepEqual(runner.calls[0], [
    '--json',
    'send-file',
    '+46700000000',
    '/tmp/static demo.png',
  ]);
});

test('polls only a new inbound message in the configured chat', async () => {
  const now = new Date('2026-08-29T08:00:00.000Z');
  const runner = new StubRunner([
    JSON.stringify({
      items: [
        message('old', now.getTime() - 1, false, '+46700000000'),
        message('mine', now.getTime(), true, '+46700000000'),
        message('wrong-chat', now.getTime(), false, '+46800000000'),
        message('reply', now.getTime(), false, '+46700000000', 'x = 4'),
      ],
      hasMore: false,
    }),
  ]);
  const provider = new IMessageCliProvider({
    recipient: '+46700000000',
    commandRunner: runner,
    pollIntervalMs: 1,
    now: () => now,
  });
  const iterator = provider.listen()[Symbol.asyncIterator]();
  const next = await iterator.next();

  assert.equal(next.value?.providerEventId, 'reply');
  assert.equal(next.value?.text, 'x = 4');
  await iterator.return?.();
});

test('deduplicates provider IDs across polls', async () => {
  const now = new Date('2026-08-29T08:00:00.000Z');
  const duplicate = message('reply-1', now.getTime(), false, '+46700000000');
  const runner = new StubRunner([
    JSON.stringify({ items: [duplicate] }),
    JSON.stringify({
      items: [
        duplicate,
        message('reply-2', now.getTime() + 1, false, '+46700000000'),
      ],
    }),
  ]);
  const provider = new IMessageCliProvider({
    recipient: '+46700000000',
    commandRunner: runner,
    pollIntervalMs: 1,
    now: () => now,
  });
  const iterator = provider.listen()[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value?.providerEventId, 'reply-1');
  assert.equal((await iterator.next()).value?.providerEventId, 'reply-2');
  await iterator.return?.();
});

test('stops polling when aborted with no matching reply', async () => {
  const runner = new StubRunner([JSON.stringify({ items: [] })]);
  const provider = new IMessageCliProvider({
    recipient: '+46700000000',
    commandRunner: runner,
    pollIntervalMs: 50,
  });
  const controller = new AbortController();
  const messages = provider.listen({ signal: controller.signal });
  const iterator = messages[Symbol.asyncIterator]();
  const pending = iterator.next();
  setTimeout(() => controller.abort(), 1);

  assert.equal((await pending).done, true);
});

test('rejects malformed CLI output and unconfigured recipients', async () => {
  const malformed = new IMessageCliProvider({
    recipient: 'student@example.com',
    commandRunner: new StubRunner(['not json']),
  });
  await assert.rejects(malformed.verify(), /malformed JSON/);

  const safe = new IMessageCliProvider({
    recipient: 'student@example.com',
    commandRunner: new StubRunner([]),
  });
  await assert.rejects(
    safe.sendMessage({
      conversationId: 'someone-else@example.com',
      text: 'hello',
      idempotencyKey: 'one',
    }),
    /unconfigured/,
  );
});

test('surfaces missing permission and executable failures without sending', async () => {
  const permissionFailure = new IMessageCliProvider({
    recipient: 'student@example.com',
    commandRunner: new FailingRunner(
      new Error('Messages Data permission is required'),
    ),
  });
  await assert.rejects(permissionFailure.verify(), /permission/);

  const missingCli = new IMessageCliProvider({
    recipient: 'student@example.com',
    commandRunner: new FailingRunner(new Error('spawn ENOENT')),
  });
  await assert.rejects(missingCli.verify(), /ENOENT/);
});

function message(
  id: string,
  timestamp: number,
  isSender: boolean,
  recipient: string,
  text = 'message',
): Record<string, unknown> {
  return {
    id,
    timestamp,
    isSender,
    senderID: recipient,
    threadID: `iMessage;-;${recipient}`,
    text,
  };
}
