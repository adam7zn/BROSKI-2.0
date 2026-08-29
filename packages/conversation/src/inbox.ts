import type { InboundMessageEvent, InboundSource } from './messaging/port.js';

interface Waiter {
  notBefore: number;
  resolve: (event: InboundMessageEvent | null) => void;
}

export class ReplyInbox {
  readonly #buffers = new Map<string, InboundMessageEvent[]>();
  readonly #waiters = new Map<string, Waiter[]>();
  readonly #seen = new Set<string>();

  push(event: InboundMessageEvent): boolean {
    const eventKey = `${event.provider}:${event.providerEventId}`;
    if (this.#seen.has(eventKey)) return false;
    this.#seen.add(eventKey);

    const arrived = Date.parse(event.receivedAt);
    const waiters = this.#waiters.get(event.providerConversationId) ?? [];
    const index = waiters.findIndex((waiter) => arrived >= waiter.notBefore);
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      waiter?.resolve(event);
      return true;
    }

    const buffer = this.#buffers.get(event.providerConversationId) ?? [];
    buffer.push(event);
    this.#buffers.set(event.providerConversationId, buffer);
    return true;
  }

  async waitFor(
    conversationId: string,
    options: { notBefore: Date; timeoutMs: number; signal?: AbortSignal },
  ): Promise<InboundMessageEvent | null> {
    const notBefore = options.notBefore.getTime();
    const buffer = this.#buffers.get(conversationId) ?? [];
    const index = buffer.findIndex(
      (event) => Date.parse(event.receivedAt) >= notBefore,
    );
    if (index >= 0) return buffer.splice(index, 1)[0] ?? null;
    if (options.signal?.aborted) return null;

    return new Promise<InboundMessageEvent | null>((resolve) => {
      const waiters = this.#waiters.get(conversationId) ?? [];
      const waiter: Waiter = { notBefore, resolve: () => {} };
      const settle = (event: InboundMessageEvent | null): void => {
        clearTimeout(timer);
        const current = this.#waiters.get(conversationId) ?? [];
        const currentIndex = current.indexOf(waiter);
        if (currentIndex >= 0) current.splice(currentIndex, 1);
        resolve(event);
      };
      const timer = setTimeout(() => settle(null), options.timeoutMs);
      waiter.resolve = settle;
      waiters.push(waiter);
      this.#waiters.set(conversationId, waiters);
      options.signal?.addEventListener('abort', () => settle(null), {
        once: true,
      });
      if (options.signal?.aborted) settle(null);
    });
  }

  async pump(source: InboundSource, signal?: AbortSignal): Promise<void> {
    const options = signal ? { signal } : {};
    for await (const event of source.listen(options)) this.push(event);
  }
}
