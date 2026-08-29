import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSendblueWebhook,
  SendblueError,
  SendblueMessagingProvider,
  verifySendblueWebhookSecret,
} from '../src/index.js';

const baseOptions = {
  apiBaseUrl: 'https://api.sendblue.co',
  apiKeyId: 'test-key-id',
  apiSecretKey: 'test-secret-key',
  fromNumber: '+13470000000',
  recipientNumber: '+46700000000',
  liveEnabled: true,
};

test('sends the exact Sendblue headers and body and maps the message handle', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = new SendblueMessagingProvider({
    ...baseOptions,
    fetchImplementation: (async (input, init) => {
      calls.push({ url: String(input), init: init! });
      if (String(input).includes('/api/evaluate-service')) {
        return imessageLookup();
      }
      return jsonResponse({
        status: 'QUEUED',
        message_handle: 'handle-1',
        date_created: '2026-08-29T12:00:00.000Z',
      });
    }) as typeof fetch,
  });

  const result = await provider.sendMessage({
    conversationId: '+46700000000',
    text: 'literal $(touch /tmp/never-run); `whoami`',
    idempotencyKey: 'demo-001:turn:0:00:question',
  });

  assert.equal(
    calls[0]?.url,
    'https://api.sendblue.co/api/evaluate-service?number=%2B46700000000',
  );
  assert.equal(calls[1]?.url, 'https://api.sendblue.co/api/send-message');
  const headers = new Headers(calls[1]?.init.headers);
  assert.equal(headers.get('sb-api-key-id'), 'test-key-id');
  assert.equal(headers.get('sb-api-secret-key'), 'test-secret-key');
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), {
    from_number: '+13470000000',
    number: '+46700000000',
    content: 'literal $(touch /tmp/never-run); `whoami`',
  });
  assert.equal(result.providerMessageId, 'handle-1');
});

test('supports only HTTPS media URLs and does not fetch when disabled', async () => {
  const bodies: unknown[] = [];
  const provider = new SendblueMessagingProvider({
    ...baseOptions,
    fetchImplementation: (async (input, init) => {
      if (String(input).includes('/api/evaluate-service')) {
        return imessageLookup();
      }
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ status: 'SENT', message_handle: 'media-1' });
    }) as typeof fetch,
  });
  await provider.sendImage({
    conversationId: '+46700000000',
    mediaUrl: 'https://cdn.example.test/example.png',
    altText: 'equation',
    caption: 'Solve this.',
    idempotencyKey: 'media',
  });
  assert.deepEqual(bodies[0], {
    from_number: '+13470000000',
    number: '+46700000000',
    media_url: 'https://cdn.example.test/example.png',
    content: 'Solve this.',
  });
  await assert.rejects(
    provider.sendImage({
      conversationId: '+46700000000',
      mediaUrl: 'file:///tmp/private.png',
      altText: 'private',
      idempotencyKey: 'private',
    }),
    (error) => error instanceof SendblueError && error.kind === 'rejected',
  );

  let called = false;
  const disabled = new SendblueMessagingProvider({
    ...baseOptions,
    liveEnabled: false,
    fetchImplementation: (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch,
  });
  await assert.rejects(
    disabled.sendMessage({
      conversationId: '+46700000000',
      text: 'never sent',
      idempotencyKey: 'disabled',
    }),
    (error) => error instanceof SendblueError && error.kind === 'disabled',
  );
  assert.equal(called, false);
});

for (const [status, kind] of [
  [401, 'authentication'],
  [429, 'rate_limited'],
  [500, 'rejected'],
] as const) {
  test(`classifies Sendblue HTTP ${status}`, async () => {
    const provider = providerWith(async () =>
      jsonResponse({ status: 'ERROR' }, status),
    );
    await assert.rejects(
      send(provider),
      (error) =>
        error instanceof SendblueError &&
        error.kind === kind &&
        error.deliveryUncertain === false,
    );
  });
}

test('classifies malformed, downgraded, timeout, and recipient failures', async () => {
  await assert.rejects(
    send(providerWith(async () => new Response('{', { status: 200 }))),
    (error) =>
      error instanceof SendblueError &&
      error.kind === 'malformed_response' &&
      error.deliveryUncertain,
  );
  await assert.rejects(
    send(
      providerWith(async () =>
        jsonResponse({
          status: 'QUEUED',
          message_handle: 'sms-1',
          was_downgraded: true,
        }),
      ),
    ),
    (error) => error instanceof SendblueError && error.kind === 'downgraded',
  );

  const timedOut = new SendblueMessagingProvider({
    ...baseOptions,
    timeoutMs: 5,
    fetchImplementation: ((input, init) => {
      if (String(input).includes('/api/evaluate-service')) {
        return Promise.resolve(imessageLookup());
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    }) as typeof fetch,
  });
  await assert.rejects(
    send(timedOut),
    (error) => error instanceof SendblueError && error.kind === 'timeout',
  );
  await assert.rejects(
    providerWith(async () => jsonResponse({})).sendMessage({
      conversationId: '+46799999999',
      text: 'wrong recipient',
      idempotencyKey: 'wrong',
    }),
    /unconfigured Sendblue recipient/,
  );
});

test('fails before POST when the recipient lookup reports SMS', async () => {
  const methods: string[] = [];
  const provider = new SendblueMessagingProvider({
    ...baseOptions,
    fetchImplementation: (async (_input, init) => {
      methods.push(init?.method ?? 'GET');
      return jsonResponse({
        number: baseOptions.recipientNumber,
        service: 'SMS',
      });
    }) as typeof fetch,
  });

  await assert.rejects(
    send(provider),
    (error) =>
      error instanceof SendblueError &&
      error.kind === 'downgraded' &&
      error.deliveryUncertain === false,
  );
  assert.deepEqual(methods, ['GET']);
});

test('validates and normalizes inbound and outbound webhook shapes', () => {
  const inbound = normalizeSendblueWebhook({
    content: ' x = 4 ',
    is_outbound: false,
    status: 'RECEIVED',
    message_handle: 'incoming-1',
    date_sent: '2026-08-29T12:00:01.000Z',
    from_number: '+46700000000',
    to_number: '+13470000000',
    sendblue_number: '+13470000000',
    group_id: '',
    opted_out: false,
    was_downgraded: false,
    service: 'iMessage',
  });
  assert.deepEqual(inbound, {
    kind: 'inbound',
    providerEventId: 'incoming-1',
    providerMessageId: 'incoming-1',
    senderAddress: '+46700000000',
    recipientAddress: '+13470000000',
    text: 'x = 4',
    occurredAt: '2026-08-29T12:00:01.000Z',
    optedOut: false,
    downgraded: false,
    service: 'iMessage',
  });

  const outbound = normalizeSendblueWebhook({
    is_outbound: true,
    status: 'DELIVERED',
    message_handle: 'outgoing-1',
    date_updated: '2026-08-29T12:00:02.000Z',
    from_number: '+13470000000',
    number: '+46700000000',
    was_downgraded: false,
    service: 'iMessage',
  });
  assert.equal(outbound.kind, 'delivery');
  if (outbound.kind === 'delivery') {
    assert.equal(outbound.eventType, 'delivered');
    assert.equal(outbound.senderAddress, '+13470000000');
  }

  assert.deepEqual(
    normalizeSendblueWebhook({
      is_outbound: false,
      status: 'RECEIVED',
      message_handle: 'group-1',
      date_sent: '2026-08-29T12:00:00.000Z',
      group_id: 'group',
    }),
    { kind: 'ignored', reason: 'group-message' },
  );
  assert.throws(() => normalizeSendblueWebhook({ status: 'RECEIVED' }));
  assert.equal(verifySendblueWebhookSecret('same', 'same'), true);
  assert.equal(verifySendblueWebhookSecret('wrong', 'same'), false);
});

function providerWith(
  implementation: () => Promise<Response>,
): SendblueMessagingProvider {
  return new SendblueMessagingProvider({
    ...baseOptions,
    fetchImplementation: (async (input) =>
      String(input).includes('/api/evaluate-service')
        ? imessageLookup()
        : implementation()) as typeof fetch,
  });
}

function send(provider: SendblueMessagingProvider) {
  return provider.sendMessage({
    conversationId: '+46700000000',
    text: 'Hello',
    idempotencyKey: 'test',
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function imessageLookup(): Response {
  return jsonResponse({
    number: baseOptions.recipientNumber,
    service: 'iMessage',
  });
}
