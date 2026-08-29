export interface OutboundText {
  conversationId: string;
  text: string;
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
  deduplicated: boolean;
}

export interface InboundMessageEvent {
  provider: string;
  providerEventId: string;
  providerMessageId: string;
  providerConversationId: string;
  senderAddress: string;
  text: string;
  receivedAt: string;
}

export interface MessagingProvider {
  readonly name: string;
  sendMessage(input: OutboundText): Promise<SendResult>;
  sendImage(input: OutboundImage): Promise<SendResult>;
}

export interface InboundSource {
  listen(options?: {
    signal?: AbortSignal;
  }): AsyncIterable<InboundMessageEvent>;
}

export class IdempotencyLedger {
  readonly #seen = new Map<string, SendResult>();

  get(key: string): SendResult | undefined {
    return this.#seen.get(key);
  }

  remember(key: string, result: SendResult): SendResult {
    this.#seen.set(key, result);
    return result;
  }
}
