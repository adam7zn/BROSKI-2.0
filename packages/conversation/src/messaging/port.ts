/**
 * Provider-neutral messaging (ADR-006).
 *
 * Nothing outside `src/messaging/` may know which provider is in use. The shape
 * follows `docs/INTEGRATIONS_AND_API.md` §4.
 */

export interface OutboundText {
  conversationId: string;
  text: string;
  /** Stable per outbound message; a provider must never send it twice. */
  idempotencyKey: string;
}

export interface OutboundImage {
  conversationId: string;
  mediaUrl: string;
  altText: string;
  caption?: string;
  idempotencyKey: string;
}

export interface SendResult {
  providerMessageId: string;
  acceptedAt: string;
  /** True when the send was suppressed because the key was already used. */
  deduplicated: boolean;
}

export interface InboundMessageEvent {
  provider: string;
  /** Provider's own event id, used to process each event at most once. */
  providerEventId: string;
  providerMessageId: string;
  providerConversationId: string;
  text: string;
  receivedAt: string;
}

export interface MessagingProvider {
  readonly name: string;
  sendMessage(input: OutboundText): Promise<SendResult>;
  sendImage(input: OutboundImage): Promise<SendResult>;
}

/**
 * A transport that can produce inbound events, either by polling or by being
 * fed webhook payloads. Kept separate from `MessagingProvider` so a
 * webhook-only deployment does not have to implement polling.
 */
export interface InboundSource {
  listen(options?: { signal?: AbortSignal }): AsyncIterable<InboundMessageEvent>;
}

/** Suppresses repeated sends of the same idempotency key. */
export class IdempotencyLedger {
  readonly #seen = new Map<string, SendResult>();

  get(key: string): SendResult | undefined {
    return this.#seen.get(key);
  }

  remember(key: string, result: SendResult): SendResult {
    this.#seen.set(key, result);
    return result;
  }

  get size(): number {
    return this.#seen.size;
  }
}
