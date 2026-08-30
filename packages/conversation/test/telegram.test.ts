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
    // The file download is a plain GET against /file/bot<token>/<path>.
    if (href.includes('/file/bot')) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }
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
    fetchImpl: impl,
    pollTimeoutSeconds: 0,
  });

  const controller = new AbortController();
  const seen: string[] = [];
  // Let the loop poll a second time before stopping, so the next offset is
  // observable in the recorded calls.
  setTimeout(() => controller.abort(), 50);
  for await (const event of telegram.listen({ signal: controller.signal })) {
    seen.push(event.text);
  }

  assert.deepEqual(seen, ['x = 4']);
  assert.equal(calls[0]?.body['offset'], 0);
  // The ignored stranger update must still move the cursor forward.
  assert.equal(calls[1]?.body['offset'], 12);
});

test('a photo arrives as an attachment, with its caption as the text', () => {
  const event = normalizeTelegramUpdate({
    update_id: 20,
    message: {
      message_id: 200,
      date: Math.floor(Date.now() / 1000),
      caption: 'här är planeringen',
      chat: { id: 555, type: 'private' },
      photo: [
        { file_id: 'small', width: 90, height: 120, file_size: 900 },
        { file_id: 'large', width: 900, height: 1200, file_size: 90_000 },
      ],
    },
  });

  assert.equal(event?.text, 'här är planeringen');
  assert.equal(event?.attachments.length, 1);
  // Telegram sends several sizes; only the largest is worth reading text off.
  assert.equal(event?.attachments[0]?.providerFileId, 'large');
  assert.equal(event?.attachments[0]?.kind, 'photo');
});

test('a PDF arrives as a document with its name and type', () => {
  const event = normalizeTelegramUpdate({
    update_id: 21,
    message: {
      message_id: 210,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 555, type: 'private' },
      document: {
        file_id: 'doc-1',
        file_name: 'planering-ht26.pdf',
        mime_type: 'application/pdf',
        file_size: 120_000,
      },
    },
  });

  assert.equal(event?.attachments[0]?.kind, 'document');
  assert.equal(event?.attachments[0]?.fileName, 'planering-ht26.pdf');
  assert.equal(event?.attachments[0]?.mimeType, 'application/pdf');
  // A file with no caption still counts as a message worth acting on.
  assert.equal(event?.text, '');
});

test('a message with neither words nor a file is ignored', () => {
  assert.equal(
    normalizeTelegramUpdate({
      update_id: 22,
      message: {
        message_id: 220,
        date: 0,
        chat: { id: 555, type: 'private' },
      },
    }),
    null,
  );
});

test('an attachment is downloaded through getFile', async () => {
  const { impl, calls } = stubFetch([
    { ok: true, result: { file_path: 'photos/file_1.jpg' } },
  ]);
  const telegram = new TelegramMessagingProvider({
    token: TOKEN,
    allowedConversationIds: ['555'],
    fetchImpl: impl,
  });

  const file = await telegram.downloadAttachment({
    kind: 'photo',
    providerFileId: 'large',
    fileName: null,
    mimeType: 'image/jpeg',
    sizeBytes: 90_000,
  });

  assert.equal(calls[0]?.method, 'getFile');
  assert.deepEqual(calls[0]?.body, { file_id: 'large' });
  assert.equal(file.mimeType, 'image/jpeg');
  assert.equal(file.fileName, 'file_1.jpg');
  assert.ok(file.bytes instanceof Uint8Array);
});

test('messages waiting since before startup are not answered', async () => {
  const startedAt = new Date('2026-08-30T01:53:00Z');
  const old = Math.floor(startedAt.getTime() / 1000) - 3600;
  const fresh = Math.floor(startedAt.getTime() / 1000) + 10;

  const { impl } = stubFetch([
    {
      ok: true,
      result: [
        // Four "hej" sent while nothing was running, and one sent just now.
        {
          update_id: 1,
          message: {
            message_id: 1,
            date: old,
            text: 'hej',
            chat: { id: 555, type: 'private' },
          },
        },
        {
          update_id: 2,
          message: {
            message_id: 2,
            date: old,
            text: 'hej',
            chat: { id: 555, type: 'private' },
          },
        },
        {
          update_id: 3,
          message: {
            message_id: 3,
            date: old,
            text: 'hej',
            chat: { id: 555, type: 'private' },
          },
        },
        {
          update_id: 4,
          message: {
            message_id: 4,
            date: fresh,
            text: 'hej igen',
            chat: { id: 555, type: 'private' },
          },
        },
      ],
    },
    { ok: true, result: [] },
  ]);

  const telegram = new TelegramMessagingProvider({
    token: TOKEN,
    allowedConversationIds: ['555'],
    fetchImpl: impl,
    pollTimeoutSeconds: 0,
    now: () => startedAt,
  });

  const controller = new AbortController();
  const seen: string[] = [];
  setTimeout(() => controller.abort(), 50);
  for await (const event of telegram.listen({ signal: controller.signal })) {
    seen.push(event.text);
  }

  // Only the message sent after listening began.
  assert.deepEqual(seen, ['hej igen']);
});

test('a test can ask for the backlog when it wants it', async () => {
  const startedAt = new Date('2026-08-30T01:53:00Z');
  const old = Math.floor(startedAt.getTime() / 1000) - 3600;

  const { impl } = stubFetch([
    {
      ok: true,
      result: [
        {
          update_id: 1,
          message: {
            message_id: 1,
            date: old,
            text: 'gammalt',
            chat: { id: 555, type: 'private' },
          },
        },
      ],
    },
    { ok: true, result: [] },
  ]);

  const telegram = new TelegramMessagingProvider({
    token: TOKEN,
    allowedConversationIds: ['555'],
    fetchImpl: impl,
    pollTimeoutSeconds: 0,
    deliverBacklog: true,
    now: () => startedAt,
  });

  const controller = new AbortController();
  const seen: string[] = [];
  setTimeout(() => controller.abort(), 50);
  for await (const event of telegram.listen({ signal: controller.signal })) {
    seen.push(event.text);
  }

  assert.deepEqual(seen, ['gammalt']);
});

test('a second companion on the same token is said out loud, not swallowed', async () => {
  const { impl } = stubFetch([
    {
      ok: false,
      error_code: 409,
      description:
        'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running',
      httpStatus: 409,
    },
  ]);
  const warnings: string[] = [];
  const telegram = new TelegramMessagingProvider({
    token: TOKEN,
    allowedConversationIds: ['555'],
    fetchImpl: impl,
    pollTimeoutSeconds: 0,
    onPollError: (message) => warnings.push(message),
  });

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 60);
  const delivered: unknown[] = [];
  for await (const event of telegram.listen({ signal: controller.signal })) {
    delivered.push(event);
  }
  assert.equal(delivered.length, 0);

  // Two processes both answer, and the student gets two replies to one
  // question. A silent retry is how that goes unnoticed.
  assert.ok(
    warnings.some((line) => line.includes('Another process')),
    `expected a conflict warning, got ${JSON.stringify(warnings)}`,
  );
});
