import {
  IdempotencyLedger,
  UnsupportedMediaError,
  type AttachmentDownloader,
  type DownloadedAttachment,
  type InboundAttachment,
  type InboundMessageEvent,
  type InboundSource,
  type MessagingProvider,
  type OutboundImage,
  type OutboundText,
  type SendResult,
} from './port.js';

const API_ROOT = 'https://api.telegram.org';
const DEFAULT_POLL_SECONDS = 30;

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly description: string,
  ) {
    // The token is in the URL, so the URL is never part of the message
    // (docs/RULES.md §5.7, docs/ARCHITECTURE.md §9).
    super(`Telegram ${method} failed (${status}): ${description}`);
    this.name = 'TelegramError';
  }
}

export interface TelegramOptions {
  token: string;
  /**
   * Chat ids allowed to talk to the companion. Everything else is ignored, so a
   * stranger who finds the bot cannot start a study session, and course
   * performance never reaches a group chat (`docs/RULES.md` §4.9).
   */
  allowedConversationIds: string[];
  pollTimeoutSeconds?: number;
  fetchImpl?: typeof fetch;
  /**
   * Whether to deliver messages that were already waiting when listening
   * started. Off by default: Telegram holds undelivered updates for a day, so
   * a companion that answers all of them replies to questions the student
   * asked hours ago, several at once. Tests turn it on.
   */
  deliverBacklog?: boolean;
  /** Overridable so a test can decide what counts as "already waiting". */
  now?: () => Date;
  /**
   * Where a failed poll goes. A dropped poll is retried either way, but it is
   * never silent: a second companion running on the same token answers the
   * same message twice, and swallowing the conflict is how that goes unnoticed
   * until a student gets two different answers.
   */
  onPollError?: (message: string) => void;
}

/** Raw update shape, narrowed to the fields the companion uses. */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    caption?: string;
    from?: { id: number };
    chat: { id: number; type: string };
    /** Telegram sends the same photo at several sizes, smallest first. */
    photo?: Array<{
      file_id: string;
      file_size?: number;
      width: number;
      height: number;
    }>;
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
  };
}

/**
 * Turns one raw update into a normalized event, or null when it is not a
 * private text message. Shared by polling and by a future webhook endpoint.
 */
export function normalizeTelegramUpdate(
  update: TelegramUpdate,
): InboundMessageEvent | null {
  const message = update.message;
  if (!message) return null;
  if (message.chat.type !== 'private') return null;

  const attachments = readAttachments(message);
  const text = message.text ?? message.caption ?? '';
  // A message with neither words nor a file is nothing to act on.
  if (text === '' && attachments.length === 0) return null;

  return {
    provider: 'telegram',
    providerEventId: String(update.update_id),
    providerMessageId: String(message.message_id),
    providerConversationId: String(message.chat.id),
    senderAddress: String(message.from?.id ?? message.chat.id),
    text,
    receivedAt: new Date(message.date * 1000).toISOString(),
    attachments,
  };
}

function readAttachments(
  message: NonNullable<TelegramUpdate['message']>,
): InboundAttachment[] {
  const attachments: InboundAttachment[] = [];

  // Telegram offers several sizes; the last is the largest and the only one
  // worth reading text off.
  const largestPhoto = message.photo?.at(-1);
  if (largestPhoto) {
    attachments.push({
      kind: 'photo',
      providerFileId: largestPhoto.file_id,
      fileName: null,
      mimeType: 'image/jpeg',
      sizeBytes: largestPhoto.file_size ?? null,
    });
  }

  if (message.document) {
    attachments.push({
      kind: 'document',
      providerFileId: message.document.file_id,
      fileName: message.document.file_name ?? null,
      mimeType: message.document.mime_type ?? null,
      sizeBytes: message.document.file_size ?? null,
    });
  }

  return attachments;
}

/**
 * Telegram Bot API adapter.
 *
 * Uses long polling, so it runs from a laptop with no public URL. The same
 * class serves a webhook deployment later: `normalizeTelegramUpdate` is the
 * whole inbound contract.
 */
export class TelegramMessagingProvider
  implements MessagingProvider, InboundSource, AttachmentDownloader
{
  readonly name = 'telegram';

  readonly #token: string;
  readonly #allowed: Set<string>;
  readonly #pollSeconds: number;
  readonly #fetch: typeof fetch;
  readonly #ledger = new IdempotencyLedger();
  readonly #deliverBacklog: boolean;
  readonly #startedAt: Date;
  readonly #onPollError: (message: string) => void;
  #offset = 0;

  constructor(options: TelegramOptions) {
    if (!options.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is missing.');
    }
    this.#token = options.token;
    this.#allowed = new Set(options.allowedConversationIds);
    this.#pollSeconds = options.pollTimeoutSeconds ?? DEFAULT_POLL_SECONDS;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#deliverBacklog = options.deliverBacklog ?? false;
    this.#startedAt = (options.now ?? (() => new Date()))();
    this.#onPollError =
      options.onPollError ?? ((message) => console.error(message));
  }

  allows(conversationId: string): boolean {
    return this.#allowed.size === 0 || this.#allowed.has(conversationId);
  }

  async sendMessage(input: OutboundText): Promise<SendResult> {
    const existing = this.#ledger.get(input.idempotencyKey);
    if (existing) return { ...existing, deduplicated: true };

    const result = await this.#call<{ message_id: number }>('sendMessage', {
      chat_id: input.conversationId,
      text: input.text,
    });
    return this.#ledger.remember(input.idempotencyKey, {
      providerMessageId: String(result.message_id),
      acceptedAt: new Date().toISOString(),
      deduplicated: false,
    });
  }

  async sendImage(input: OutboundImage): Promise<SendResult> {
    const existing = this.#ledger.get(input.idempotencyKey);
    if (existing) return { ...existing, deduplicated: true };

    if (input.media.kind !== 'url') {
      // Sending a local file needs a multipart upload, which nothing asks for
      // yet; failing loudly beats silently sending nothing.
      throw new UnsupportedMediaError(this.name, input.media.kind);
    }
    const result = await this.#call<{ message_id: number }>('sendPhoto', {
      chat_id: input.conversationId,
      photo: input.media.url,
      caption: input.caption ?? input.altText,
    });
    return this.#ledger.remember(input.idempotencyKey, {
      providerMessageId: String(result.message_id),
      acceptedAt: new Date().toISOString(),
      deduplicated: false,
    });
  }

  /**
   * Fetches the bytes behind an attachment.
   *
   * The Bot API caps downloads at 20 MB, which a photo of a page is nowhere
   * near; a larger file fails here rather than half-way through reading it.
   */
  async downloadAttachment(
    attachment: InboundAttachment,
  ): Promise<DownloadedAttachment> {
    const file = await this.#call<{ file_path?: string; file_size?: number }>(
      'getFile',
      { file_id: attachment.providerFileId },
    );
    if (!file.file_path) {
      throw new TelegramError('getFile', 200, 'no file path in response');
    }

    const response = await this.#fetch(
      `${API_ROOT}/file/bot${this.#token}/${file.file_path}`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!response.ok) {
      throw new TelegramError('getFile', response.status, 'download failed');
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType:
        attachment.mimeType ??
        response.headers.get('content-type') ??
        'application/octet-stream',
      fileName: attachment.fileName ?? file.file_path.split('/').at(-1) ?? null,
    };
  }

  async *listen(
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<InboundMessageEvent> {
    while (!options.signal?.aborted) {
      // Hand control back to the event loop every round. A long poll normally
      // blocks for ~30s, but if the API answers instantly the loop would
      // otherwise spin on microtasks alone and starve timers and abort
      // handlers.
      await delay(0, options.signal);
      if (options.signal?.aborted) return;

      let updates: TelegramUpdate[];
      try {
        updates = await this.#call<TelegramUpdate[]>(
          'getUpdates',
          {
            offset: this.#offset,
            timeout: this.#pollSeconds,
            allowed_updates: ['message'],
          },
          // Give the request longer than the long poll itself.
          (this.#pollSeconds + 15) * 1000,
        );
      } catch (error) {
        if (options.signal?.aborted) return;
        this.#onPollError(describePollFailure(error));
        // A dropped poll is transient; back off briefly and keep listening.
        await delay(2000, options.signal);
        if (options.signal?.aborted) return;
        if (isFatal(error)) throw error;
        continue;
      }

      for (const update of updates) {
        // Advance past every update, including ones we ignore, so an unknown
        // update type cannot wedge the poll loop.
        this.#offset = Math.max(this.#offset, update.update_id + 1);
        const event = normalizeTelegramUpdate(update);
        if (!event || !this.allows(event.providerConversationId)) continue;
        if (!this.#deliverBacklog && this.#isBacklog(event)) {
          // Answering it now would be answering something already given up on.
          continue;
        }
        yield event;
      }
    }
  }

  /**
   * Sent before this process started listening.
   *
   * Telegram timestamps are whole seconds, so the cutoff is the start of the
   * second we began in: without that, a message sent moments after startup
   * carries a timestamp fractionally earlier than the start and would be
   * discarded as old.
   */
  #isBacklog(event: InboundMessageEvent): boolean {
    const cutoff = Math.floor(this.#startedAt.getTime() / 1000) * 1000;
    return Date.parse(event.receivedAt) < cutoff;
  }

  async #call<T>(
    method: string,
    body: Record<string, unknown>,
    timeoutMs = 20_000,
  ): Promise<T> {
    const response = await this.#fetch(
      `${API_ROOT}/bot${this.#token}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );

    const payload = (await response.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new TelegramError(
        method,
        response.status,
        payload.description ?? 'unknown error',
      );
    }
    return payload.result;
  }
}

/**
 * What to say about a poll that failed.
 *
 * 409 gets its own line because it is not a network hiccup and not something
 * to wait out: Telegram hands each update to whichever poller asked last, so
 * two companions on one token both answer, and the student sees two replies to
 * one question — one of them about the wrong exercise.
 */
function describePollFailure(error: unknown): string {
  if (error instanceof TelegramError && error.status === 409) {
    return (
      'Another process is already listening to this bot. Stop it — otherwise ' +
      'both answer, and the student gets two different replies to one message.'
    );
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `Telegram poll failed, retrying: ${detail}`;
}

/** 401/404 mean a bad token or bot; retrying forever would just hide that. */
function isFatal(error: unknown): boolean {
  return (
    error instanceof TelegramError &&
    (error.status === 401 || error.status === 404)
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
