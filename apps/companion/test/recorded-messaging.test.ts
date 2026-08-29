import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeMessagingProvider } from '@math-study-companion/conversation';

import type { StoredEvent } from '../src/api-client.js';
import {
  RecordedMessagingProvider,
  type MessagingEventApi,
} from '../src/recorded-messaging.js';

test('reserves before sending and suppresses a repeated outbound message', async () => {
  const provider = new FakeMessagingProvider();
  const api = new FakeEventApi();
  const messaging = new RecordedMessagingProvider('demo-001', provider, api);
  const input = {
    conversationId: 'student',
    text: 'Question',
    idempotencyKey: 'demo-001:question',
  };

  const first = await messaging.sendMessage(input);
  const second = await messaging.sendMessage(input);

  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(provider.sent.length, 1);
  assert.equal(api.events.length, 1);
});

class FakeEventApi implements MessagingEventApi {
  readonly reservations = new Set<string>();
  readonly events: StoredEvent[] = [];

  async reserveOutbound(
    interactionId: string,
    idempotencyKey: string,
  ): Promise<'reserved' | 'duplicate'> {
    const key = `${interactionId}:${idempotencyKey}`;
    if (this.reservations.has(key)) return 'duplicate';
    this.reservations.add(key);
    return 'reserved';
  }

  async recordEvent(
    interactionId: string,
    event: Omit<StoredEvent, 'id' | 'interactionId' | 'traceId' | 'recordedAt'>,
  ): Promise<'recorded'> {
    this.events.push({
      id: `event-${this.events.length + 1}`,
      interactionId,
      traceId: 'trace-001',
      ...event,
      recordedAt: new Date().toISOString(),
    });
    return 'recorded';
  }

  async listEvents(): Promise<StoredEvent[]> {
    return structuredClone(this.events);
  }
}
