import type { InboundMessageEvent, InboundSource } from './messaging/port.js';

interface Waiter {
  notBefore: number;
  resolve: (event: InboundMessageEvent) => void;
}

/**
 * Buffers inbound messages per conversation and hands them to whoever is
 * waiting for a reply.
 *
 * Two rules from `docs/RULES.md` §4 live here: each provider event is processed
 * at most once (§4.5), and a reply is only correlated to a study item when it
 * arrived after that item was sent (§4.6) — a message the student sent while we
 * were still thinking is not an answer to a question he had not seen yet.
 */
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
    if (index !== -1) {
      const [waiter] = waiters.splice(index, 1);
      waiter!.resolve(event);
      return true;
    }

    const buffer = this.#buffers.get(event.providerConversationId) ?? [];
    buffer.push(event);
    this.#buffers.set(event.providerConversationId, buffer);
    return true;
  }

  /** Resolves with the next reply, or null on timeout or abort. */
  async waitFor(
    conversationId: string,
    options: { notBefore: Date; timeoutMs: number; signal?: AbortSignal },
  ): Promise<InboundMessageEvent | null> {
    const notBefore = options.notBefore.getTime();

    const buffer = this.#buffers.get(conversationId) ?? [];
    const buffered = buffer.findIndex(
      (event) => Date.parse(event.receivedAt) >= notBefore,
    );
    if (buffered !== -1) {
      const [event] = buffer.splice(buffered, 1);
      return event!;
    }
    if (options.signal?.aborted) return null;

    return new Promise<InboundMessageEvent | null>((resolve) => {
      const waiter: Waiter = { notBefore, resolve };
      const waiters = this.#waiters.get(conversationId) ?? [];
      waiters.push(waiter);
      this.#waiters.set(conversationId, waiters);

      const settle = (value: InboundMessageEvent | null) => {
        clearTimeout(timer);
        const current = this.#waiters.get(conversationId) ?? [];
        const index = current.indexOf(waiter);
        if (index !== -1) current.splice(index, 1);
        resolve(value);
      };

      const timer = setTimeout(() => settle(null), options.timeoutMs);
      waiter.resolve = (event) => settle(event);
      options.signal?.addEventListener('abort', () => settle(null), {
        once: true,
      });
    });
  }

  /**
   * Pumps a transport into this inbox until the signal aborts.
   *
   * `intercept` sees every event first and returns true for the ones it has
   * dealt with — an uploaded photo, say, which is not an answer to any
   * question and must not be correlated with one. There is exactly one listener
   * per transport: a second concurrent one would race it for the same messages.
   */
  async pump(
    source: InboundSource,
    signal?: AbortSignal,
    options: {
      intercept?: (event: InboundMessageEvent) => boolean | Promise<boolean>;
    } = {},
  ): Promise<void> {
    const listenOptions = signal ? { signal } : {};
    for await (const event of source.listen(listenOptions)) {
      if (options.intercept && (await options.intercept(event))) continue;
      this.push(event);
    }
  }
}
