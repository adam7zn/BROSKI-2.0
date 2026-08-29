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

/**
 * Where an image comes from.
 *
 * The two providers need different things — iMessage sends a file from this
 * machine, Telegram takes a URL and fetches it itself — and neither can quietly
 * substitute for the other, so the caller states which one it has and an
 * adapter rejects what it cannot deliver.
 */
export type MediaSource =
  { kind: 'url'; url: string } | { kind: 'file'; path: string };

export interface OutboundImage {
  conversationId: string;
  media: MediaSource;
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

/**
 * A photo or file the student sent.
 *
 * Only the reference is carried around; the bytes are fetched on demand, so an
 * unread attachment costs nothing and never sits in memory.
 */
export interface InboundAttachment {
  kind: 'photo' | 'document';
  /** The provider's own handle for the file. */
  providerFileId: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface DownloadedAttachment {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string | null;
}

/** A provider that can hand over the bytes behind an attachment. */
export interface AttachmentDownloader {
  downloadAttachment(
    attachment: InboundAttachment,
  ): Promise<DownloadedAttachment>;
}

export interface InboundMessageEvent {
  provider: string;
  /** Provider's own event id, used to process each event at most once. */
  providerEventId: string;
  providerMessageId: string;
  providerConversationId: string;
  /** Who sent it, in whatever form the provider identifies people. */
  senderAddress: string;
  text: string;
  receivedAt: string;
  /** Photos and files sent with the message. Usually empty. */
  attachments: InboundAttachment[];
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
  listen(options?: {
    signal?: AbortSignal;
  }): AsyncIterable<InboundMessageEvent>;
}

/** Raised when a provider is handed media it cannot send. */
export class UnsupportedMediaError extends Error {
  constructor(provider: string, kind: MediaSource['kind']) {
    super(`The ${provider} adapter cannot send media of kind "${kind}".`);
    this.name = 'UnsupportedMediaError';
  }
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
