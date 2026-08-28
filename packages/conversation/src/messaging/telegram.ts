import {
  IdempotencyLedger,
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
}

/** Raw update shape, narrowed to the fields the companion uses. */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: { id: number; type: string };
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
  if (!message?.text) return null;
  if (message.chat.type !== 'private') return null;

  return {
    provider: 'telegram',
    providerEventId: String(update.update_id),
    providerMessageId: String(message.message_id),
    providerConversationId: String(message.chat.id),
    text: message.text,
    receivedAt: new Date(message.date * 1000).toISOString(),
  };
}

/**
 * Telegram Bot API adapter.
 *
 * Uses long polling, so it runs from a laptop with no public URL. The same
 * class serves a webhook deployment later: `normalizeTelegramUpdate` is the
 * whole inbound contract.
 */
export class TelegramMessagingProvider implements MessagingProvider, InboundSource {
  readonly name = 'telegram';

  readonly #token: string;
  readonly #allowed: Set<string>;
  readonly #pollSeconds: number;
  readonly #fetch: typeof fetch;
  readonly #ledger = new IdempotencyLedger();
  #offset = 0;

  constructor(options: TelegramOptions) {
    if (!options.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is missing.');
    }
    this.#token = options.token;
    this.#allowed = new Set(options.allowedConversationIds);
    this.#pollSeconds = options.pollTimeoutSeconds ?? DEFAULT_POLL_SECONDS;
    this.#fetch = options.fetchImpl ?? fetch;
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

    const result = await this.#call<{ message_id: number }>('sendPhoto', {
      chat_id: input.conversationId,
      photo: input.mediaUrl,
      caption: input.caption ?? input.altText,
    });
    return this.#ledger.remember(input.idempotencyKey, {
      providerMessageId: String(result.message_id),
      acceptedAt: new Date().toISOString(),
      deduplicated: false,
    });
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
        if (event && this.allows(event.providerConversationId)) {
          yield event;
        }
      }
    }
  }

  async #call<T>(
    method: string,
    body: Record<string, unknown>,
    timeoutMs = 20_000,
  ): Promise<T> {
    const response = await this.#fetch(`${API_ROOT}/bot${this.#token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

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
