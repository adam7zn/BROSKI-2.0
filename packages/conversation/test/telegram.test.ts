import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TelegramError,
  TelegramMessagingProvider,
  normalizeTelegramUpdate,
  type TelegramUpdate,
} from '../src/messaging/telegram.js';

const TOKEN = 'test-token-not-a-real-one';

interface Call {
  method: string;
  body: Record<string, unknown>;
}

/** A fetch stub that records calls and replays queued Bot API responses. */
function stubFetch(responses: unknown[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({
      method: href.slice(href.lastIndexOf('/') + 1),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const next = responses.shift() ?? { ok: true, result: [] };
    return new Response(JSON.stringify(next), {
      status: (next as { httpStatus?: number }).httpStatus ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function textUpdate(id: number, chatId: number, text: string): TelegramUpdate {
  return {
    update_id: id,
    message: {
      message_id: id * 10,
      date: Math.floor(Date.now() / 1000),
      text,
      chat: { id: chatId, type: 'private' },
    },
  };
}

test('a private text message normalizes to an inbound event', () => {
  const event = normalizeTelegramUpdate(textUpdate(1, 555, 'x = 4'));
  assert.equal(event?.provider, 'telegram');
  assert.equal(event?.providerConversationId, '555');
  assert.equal(event?.providerEventId, '1');
  assert.equal(event?.text, 'x = 4');
});

test('group chats and non-text updates are ignored', () => {
  assert.equal(
    normalizeTelegramUpdate({
      update_id: 2,
      message: {
        message_id: 20,
        date: 0,
        text: 'hi',
        chat: { id: -100, type: 'group' },
      },
    }),
    null,
  );
  assert.equal(normalizeTelegramUpdate({ update_id: 3 }), null);
});

test('sendMessage posts to the chat and returns the provider message id', async () => {
  const { impl, calls } = stubFetch([{ ok: true, result: { message_id: 99 } }]);
  const telegram = new TelegramMessagingProvider({
    token: TOKEN,
    allowedConversationIds: ['555'],
    fetchImpl: impl,
  });

  const result = await telegram.sendMessage({
    conversationId: '555',
    text: 'Solve 2x + 3 = 11.',
    idempotencyKey: 'demo-001:question',
  });

  assert.equal(result.providerMessageId, '99');
  assert.equal(result.deduplicated, false);
  assert.equal(calls[0]?.method, 'sendMessage');
  assert.deepEqual(calls[0]?.body, {
    chat_id: '555',
    text: 'Solve 2x + 3 = 11.',
  });
});

test('a repeated idempotency key never reaches the provider', async () => {
  const { impl, calls } = stubFetch([{ ok: true, result: { message_id: 99 } }]);
  const telegram = new TelegramMessagingProvider({
    token: TOKEN,
    allowedConversationIds: ['555'],
    fetchImpl: impl,
  });
  const send = () =>
    telegram.sendMessage({
      conversationId: '555',
      text: 'Solve 2x + 3 = 11.',
      idempotencyKey: 'demo-001:question',
    });

  await send();
  const second = await send();

  assert.equal(calls.length, 1);
  assert.equal(second.deduplicated, true);
});

test('an API error names the method and status but never the token', async () => {
  const { impl } = stubFetch([
    { ok: false, description: 'chat not found', httpStatus: 400 },
  ]);
  const telegram = new TelegramMessagingProvider({
    token: TOKEN,
    allowedConversationIds: ['555'],
    fetchImpl: impl,
  });

  await assert.rejects(
    telegram.sendMessage({
      conversationId: '555',
      text: 'hi',
      idempotencyKey: 'k',
    }),
    (error: unknown) => {
      assert.ok(error instanceof TelegramError);
      assert.match(error.message, /sendMessage failed \(400\): chat not found/);
      assert.ok(!error.message.includes(TOKEN));
      return true;
    },
  );
});

test('polling yields allowed chats only and advances the offset past every update', async () => {
  const controller = new AbortController();
  const { impl, calls } = stubFetch([
    {
      ok: true,
      result: [textUpdate(10, 999, 'stranger'), textUpdate(11, 555, 'x = 4')],
    },
    { ok: true, result: [] },
  ]);
  const telegram = new TelegramMessagingProvider({
    token: TOKEN,
    allowedConversationIds: ['555'],
    fetchImpl: async (...args) => {
      const response = await impl(...args);
      if (calls.length === 2) controller.abort();
      return response;
    },
    pollTimeoutSeconds: 0,
  });

  const seen: string[] = [];
  for await (const event of telegram.listen({ signal: controller.signal })) {
    seen.push(event.text);
  }

  assert.deepEqual(seen, ['x = 4']);
  assert.equal(calls[0]?.body['offset'], 0);
  // The ignored stranger update must still move the cursor forward.
  assert.equal(calls[1]?.body['offset'], 12);
});
