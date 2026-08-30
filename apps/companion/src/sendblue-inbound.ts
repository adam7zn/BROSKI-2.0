import { createServer, type Server } from 'node:http';

import {
  normalizeSendblueWebhook,
  verifySendblueWebhookSecret,
  type InboundMessageEvent,
  type InboundSource,
} from '@math-study-companion/conversation';

/**
 * Receives Sendblue's webhooks and turns them into inbound messages.
 *
 * Sendblue pushes rather than being polled, so unlike Telegram this needs a
 * URL it can reach. In a codespace that means forwarding the port publicly;
 * anywhere else, whatever the deployment already exposes.
 *
 * The parsing and the secret check are Sendblue's own contract and are reused
 * verbatim from `packages/conversation/src/messaging/sendblue.ts` rather than
 * written twice.
 */
export interface SendblueInboundOptions {
  port: number;
  webhookSecret: string;
  /** Only this number may reach the companion. */
  recipientNumber: string;
  path?: string;
  onDelivery?: (event: {
    providerMessageId: string;
    eventType: string;
  }) => void;
}

export class SendblueInboundServer implements InboundSource {
  readonly #options: SendblueInboundOptions;
  readonly #queue: InboundMessageEvent[] = [];
  #server: Server | null = null;
  #waiting: (() => void) | null = null;

  constructor(options: SendblueInboundOptions) {
    this.#options = options;
  }

  /** Starts listening. Resolves once the port is bound. */
  async start(): Promise<void> {
    const path = this.#options.path ?? '/webhooks/sendblue';

    this.#server = createServer((request, response) => {
      if (request.method !== 'POST' || !request.url?.startsWith(path)) {
        response.writeHead(404).end();
        return;
      }

      // The shared secret arrives as a header or a query parameter depending on
      // how the webhook was registered; accept either.
      const url = new URL(request.url, 'http://localhost');
      const supplied =
        header(request.headers['sb-signing-secret']) ??
        header(request.headers['x-sendblue-secret']) ??
        url.searchParams.get('secret') ??
        undefined;

      if (!verifySendblueWebhookSecret(supplied, this.#options.webhookSecret)) {
        response.writeHead(401).end();
        return;
      }

      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
        // A webhook is small; anything huge is not one.
        if (body.length > 100_000) request.destroy();
      });
      request.on('end', () => {
        try {
          this.#accept(JSON.parse(body) as unknown);
          response.writeHead(200).end('ok');
        } catch (error) {
          console.error('  webhook rejected:', describe(error));
          response.writeHead(400).end();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.#server!.once('error', reject);
      this.#server!.listen(this.#options.port, '0.0.0.0', resolve);
    });
  }

  stop(): void {
    this.#server?.close();
    this.#server = null;
    this.#waiting?.();
  }

  #accept(payload: unknown): void {
    const normalized = normalizeSendblueWebhook(payload);

    if (normalized.kind === 'delivery') {
      this.#options.onDelivery?.({
        providerMessageId: normalized.providerMessageId,
        eventType: normalized.eventType,
      });
      return;
    }
    if (normalized.kind === 'ignored') return;

    // Someone else's number is not the student's (docs/RULES.md §4.9).
    if (normalized.senderAddress !== this.#options.recipientNumber) return;

    this.#queue.push({
      provider: 'sendblue',
      providerEventId: normalized.providerEventId,
      providerMessageId: normalized.providerMessageId,
      providerConversationId: normalized.senderAddress,
      senderAddress: normalized.senderAddress,
      text: normalized.text,
      receivedAt: normalized.occurredAt,
      // Sendblue delivers media as separate URLs; not read yet.
      attachments: [],
    });
    this.#waiting?.();
  }

  async *listen(
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<InboundMessageEvent> {
    while (!options.signal?.aborted) {
      const next = this.#queue.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.#waiting = resolve;
        options.signal?.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
      this.#waiting = null;
    }
  }
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
