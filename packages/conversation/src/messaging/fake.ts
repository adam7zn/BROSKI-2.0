import {
  IdempotencyLedger,
  type InboundMessageEvent,
  type InboundSource,
  type MessagingProvider,
  type OutboundImage,
  type OutboundText,
  type SendResult,
} from './port.js';

export interface SentRecord {
  kind: 'text' | 'image';
  conversationId: string;
  text: string;
  idempotencyKey: string;
}

/**
 * In-memory messaging used by tests and the local chat runner.
 *
 * Replies are pushed in with `deliver()`; `listen()` yields them in order.
 */
export class FakeMessagingProvider implements MessagingProvider, InboundSource {
  readonly name = 'fake';
  readonly sent: SentRecord[] = [];

  readonly #ledger = new IdempotencyLedger();
  readonly #queue: InboundMessageEvent[] = [];
  #waiting: (() => void) | null = null;
  #counter = 0;

  async sendMessage(input: OutboundText): Promise<SendResult> {
    return this.#send('text', input.conversationId, input.text, input.idempotencyKey);
  }

  async sendImage(input: OutboundImage): Promise<SendResult> {
    const text = input.caption ?? input.altText;
    return this.#send('image', input.conversationId, text, input.idempotencyKey);
  }

  /** Simulates the student sending a reply. */
  deliver(conversationId: string, text: string): InboundMessageEvent {
    this.#counter += 1;
    const event: InboundMessageEvent = {
      provider: this.name,
      providerEventId: `fake-event-${this.#counter}`,
      providerMessageId: `fake-message-${this.#counter}`,
      providerConversationId: conversationId,
      text,
      receivedAt: new Date().toISOString(),
    };
    this.#queue.push(event);
    this.#waiting?.();
    return event;
  }

  async *listen(options: { signal?: AbortSignal } = {}): AsyncIterable<InboundMessageEvent> {
    while (!options.signal?.aborted) {
      const next = this.#queue.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.#waiting = resolve;
        options.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      this.#waiting = null;
    }
  }

  #send(
    kind: SentRecord['kind'],
    conversationId: string,
    text: string,
    idempotencyKey: string,
  ): SendResult {
    const existing = this.#ledger.get(idempotencyKey);
    if (existing) return { ...existing, deduplicated: true };

    this.sent.push({ kind, conversationId, text, idempotencyKey });
    return this.#ledger.remember(idempotencyKey, {
      providerMessageId: `fake-out-${this.sent.length}`,
      acceptedAt: new Date().toISOString(),
      deduplicated: false,
    });
  }
}
