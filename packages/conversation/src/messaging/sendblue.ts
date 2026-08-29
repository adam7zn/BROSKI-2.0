import { createHash, timingSafeEqual } from 'node:crypto';

import type {
  MessagingProvider,
  OutboundImage,
  OutboundText,
  SendResult,
} from './port.js';

export type SendblueErrorKind =
  | 'authentication'
  | 'disabled'
  | 'downgraded'
  | 'malformed_response'
  | 'network'
  | 'rate_limited'
  | 'rejected'
  | 'timeout';

export class SendblueError extends Error {
  constructor(
    readonly kind: SendblueErrorKind,
    readonly deliveryUncertain: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SendblueError';
  }
}

export interface SendblueProviderOptions {
  apiBaseUrl: string;
  apiKeyId: string;
  apiSecretKey: string;
  fromNumber: string;
  recipientNumber: string;
  liveEnabled: boolean;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
}

export class SendblueMessagingProvider implements MessagingProvider {
  readonly name = 'sendblue';
  readonly #sendUrl: URL;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(private readonly options: SendblueProviderOptions) {
    assertE164(options.fromNumber, 'Sendblue sender');
    assertE164(options.recipientNumber, 'Sendblue recipient');
    this.#sendUrl = new URL('/api/send-message', options.apiBaseUrl);
    if (this.#sendUrl.protocol !== 'https:') {
      throw new Error('Sendblue API base URL must use HTTPS');
    }
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  sendMessage(input: OutboundText): Promise<SendResult> {
    this.#assertRecipient(input.conversationId);
    if (!input.text.trim() || input.text.length > 18_996) {
      throw new SendblueError(
        'rejected',
        false,
        'Sendblue message content is invalid',
      );
    }
    return this.#send({ content: input.text });
  }

  sendImage(input: OutboundImage): Promise<SendResult> {
    this.#assertRecipient(input.conversationId);
    let mediaUrl: URL;
    try {
      mediaUrl = new URL(input.mediaUrl);
    } catch (error) {
      throw new SendblueError(
        'rejected',
        false,
        'Sendblue media URL is invalid',
        { cause: error },
      );
    }
    if (mediaUrl.protocol !== 'https:' || mediaUrl.href.length > 2_048) {
      throw new SendblueError(
        'rejected',
        false,
        'Sendblue media URL must use HTTPS',
      );
    }
    return this.#send({
      media_url: mediaUrl.href,
      ...(input.caption ? { content: input.caption } : {}),
    });
  }

  async #send(content: Record<string, string>): Promise<SendResult> {
    if (!this.options.liveEnabled) {
      throw new SendblueError(
        'disabled',
        false,
        'Live Sendblue delivery is disabled',
      );
    }
    await this.#assertIMessageCapable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(this.#sendUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'sb-api-key-id': this.options.apiKeyId,
          'sb-api-secret-key': this.options.apiSecretKey,
        },
        body: JSON.stringify({
          from_number: this.options.fromNumber,
          number: this.options.recipientNumber,
          ...content,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new SendblueError(
        timedOut ? 'timeout' : 'network',
        true,
        timedOut
          ? 'Sendblue request timed out with uncertain delivery'
          : 'Sendblue network request failed with uncertain delivery',
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch (error) {
      throw new SendblueError(
        'malformed_response',
        response.ok,
        'Sendblue returned malformed JSON',
        { cause: error },
      );
    }
    if (!response.ok) {
      const kind =
        response.status === 401 || response.status === 403
          ? 'authentication'
          : response.status === 429
            ? 'rate_limited'
            : 'rejected';
      throw new SendblueError(
        kind,
        false,
        `Sendblue rejected the request (${response.status})`,
      );
    }
    if (
      !isRecord(body) ||
      typeof body.message_handle !== 'string' ||
      !body.message_handle.trim() ||
      body.message_handle.length > 200
    ) {
      throw new SendblueError(
        'malformed_response',
        true,
        'Sendblue response did not include a message handle',
      );
    }
    if (
      (body.is_outbound !== undefined && body.is_outbound !== true) ||
      (body.from_number !== undefined &&
        body.from_number !== this.options.fromNumber) ||
      (body.number !== undefined &&
        body.number !== this.options.recipientNumber) ||
      (body.was_downgraded !== undefined &&
        body.was_downgraded !== null &&
        typeof body.was_downgraded !== 'boolean') ||
      (body.error_code !== undefined &&
        body.error_code !== null &&
        typeof body.error_code !== 'number' &&
        typeof body.error_code !== 'string')
    ) {
      throw new SendblueError(
        'malformed_response',
        true,
        'Sendblue response fields failed validation',
      );
    }
    if (body.was_downgraded === true) {
      throw new SendblueError(
        'downgraded',
        true,
        'Sendblue downgraded the message from iMessage',
      );
    }
    if (
      typeof body.service === 'string' &&
      body.service.toLowerCase() !== 'imessage'
    ) {
      throw new SendblueError(
        'downgraded',
        true,
        'Sendblue selected a non-iMessage service',
      );
    }
    const status =
      typeof body.status === 'string' ? body.status.toUpperCase() : '';
    if (
      ![
        'REGISTERED',
        'PENDING',
        'QUEUED',
        'ACCEPTED',
        'SENT',
        'DELIVERED',
        'SUCCESS',
        'ERROR',
        'DECLINED',
      ].includes(status)
    ) {
      throw new SendblueError(
        'malformed_response',
        true,
        'Sendblue response included an invalid status',
      );
    }
    if (
      status === 'ERROR' ||
      status === 'DECLINED' ||
      (body.error_code !== undefined &&
        body.error_code !== null &&
        body.error_code !== 0)
    ) {
      throw new SendblueError('rejected', false, 'Sendblue reported an error');
    }
    let acceptedAt: string;
    try {
      acceptedAt = timestamp(body) ?? this.#now().toISOString();
    } catch (error) {
      throw new SendblueError(
        'malformed_response',
        true,
        'Sendblue response timestamp failed validation',
        { cause: error },
      );
    }
    return {
      providerMessageId: body.message_handle,
      acceptedAt,
      deduplicated: false,
    };
  }

  async #assertIMessageCapable(): Promise<void> {
    const lookupUrl = new URL('/api/evaluate-service', this.#sendUrl);
    lookupUrl.searchParams.set('number', this.options.recipientNumber);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(lookupUrl, {
        method: 'GET',
        headers: this.#authenticationHeaders(),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new SendblueError(
        timedOut ? 'timeout' : 'network',
        false,
        timedOut
          ? 'Sendblue iMessage lookup timed out before delivery'
          : 'Sendblue iMessage lookup failed before delivery',
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch (error) {
      throw new SendblueError(
        'malformed_response',
        false,
        'Sendblue iMessage lookup returned malformed JSON',
        { cause: error },
      );
    }
    if (!response.ok) {
      const kind =
        response.status === 401 || response.status === 403
          ? 'authentication'
          : response.status === 429
            ? 'rate_limited'
            : 'rejected';
      throw new SendblueError(
        kind,
        false,
        `Sendblue iMessage lookup failed (${response.status})`,
      );
    }
    if (
      !isRecord(body) ||
      body.number !== this.options.recipientNumber ||
      (body.service !== 'iMessage' && body.service !== 'SMS')
    ) {
      throw new SendblueError(
        'malformed_response',
        false,
        'Sendblue iMessage lookup response failed validation',
      );
    }
    if (body.service !== 'iMessage') {
      throw new SendblueError(
        'downgraded',
        false,
        'Sendblue recipient is not currently iMessage-capable',
      );
    }
  }

  #authenticationHeaders(): Record<string, string> {
    return {
      accept: 'application/json',
      'sb-api-key-id': this.options.apiKeyId,
      'sb-api-secret-key': this.options.apiSecretKey,
    };
  }

  #assertRecipient(conversationId: string): void {
    if (
      normalizePhone(conversationId) !==
      normalizePhone(this.options.recipientNumber)
    ) {
      throw new SendblueError(
        'rejected',
        false,
        'Refusing to message an unconfigured Sendblue recipient',
      );
    }
  }
}

export type NormalizedSendblueWebhook =
  | { kind: 'ignored'; reason: string }
  | {
      kind: 'inbound';
      providerEventId: string;
      providerMessageId: string;
      senderAddress: string;
      recipientAddress: string;
      text: string;
      occurredAt: string;
      optedOut: boolean;
      downgraded: boolean;
      service: string;
    }
  | {
      kind: 'delivery';
      providerEventId: string;
      providerMessageId: string;
      senderAddress: string;
      recipientAddress: string;
      eventType: 'sent' | 'delivered' | 'failed';
      occurredAt: string;
      downgraded: boolean;
      service: string;
    };

export function normalizeSendblueWebhook(
  payload: unknown,
): NormalizedSendblueWebhook {
  if (!isRecord(payload)) throw new Error('Sendblue webhook must be an object');
  const handle = boundedString(payload.message_handle, 'message_handle', 200);
  const status = requiredString(payload.status, 'status').toUpperCase();
  const occurredAt = webhookTimestamp(payload);
  if (typeof payload.is_outbound !== 'boolean') {
    throw new Error('Sendblue webhook is missing is_outbound');
  }
  const groupId = optionalString(payload.group_id);
  if (groupId || payload.message_type === 'group') {
    return { kind: 'ignored', reason: 'group-message' };
  }
  if (payload.is_outbound) {
    const eventType =
      status === 'SENT'
        ? 'sent'
        : status === 'DELIVERED'
          ? 'delivered'
          : status === 'ERROR' || status === 'DECLINED'
            ? 'failed'
            : null;
    if (!eventType) return { kind: 'ignored', reason: 'non-terminal-status' };
    return {
      kind: 'delivery',
      providerEventId: `sendblue:${createHash('sha256')
        .update(`${handle}:${status}:${occurredAt}`)
        .digest('hex')}`,
      providerMessageId: handle,
      senderAddress: requiredString(payload.from_number, 'from_number'),
      recipientAddress:
        optionalString(payload.number) ??
        requiredString(payload.to_number, 'to_number'),
      eventType,
      occurredAt,
      downgraded: payload.was_downgraded === true,
      service: requiredString(payload.service, 'service'),
    };
  }
  if (status !== 'RECEIVED') {
    return { kind: 'ignored', reason: 'not-received' };
  }
  return {
    kind: 'inbound',
    providerEventId: handle,
    providerMessageId: handle,
    senderAddress: requiredString(payload.from_number, 'from_number'),
    recipientAddress:
      optionalString(payload.sendblue_number) ??
      requiredString(payload.to_number, 'to_number'),
    text: boundedString(payload.content, 'content', 18_996).trim(),
    occurredAt,
    optedOut: payload.opted_out === true,
    downgraded: payload.was_downgraded === true,
    service: optionalString(payload.service) ?? '',
  };
}

export function verifySendblueWebhookSecret(
  supplied: string | undefined,
  expected: string,
): boolean {
  if (!supplied || !expected) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

function webhookTimestamp(payload: Record<string, unknown>): string {
  const value =
    optionalString(payload.date_updated) ?? optionalString(payload.date_sent);
  if (!value || Number.isNaN(new Date(value).getTime())) {
    throw new Error('Sendblue webhook timestamp is invalid');
  }
  return new Date(value).toISOString();
}

function timestamp(payload: Record<string, unknown>): string | null {
  for (const key of ['date_created', 'date_sent', 'date_updated']) {
    const rawValue = payload[key];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    if (typeof rawValue !== 'string' || Number.isNaN(new Date(rawValue).getTime())) {
      throw new Error(`Sendblue response field ${key} is invalid`);
    }
    return new Date(rawValue).toISOString();
  }
  return null;
}

function assertE164(value: string, name: string): void {
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    throw new Error(`${name} must use E.164 format`);
  }
}

function normalizePhone(value: string): string {
  return value.replace(/[\s()-]/g, '');
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Sendblue webhook field ${name} is invalid`);
  }
  return value;
}

function boundedString(value: unknown, name: string, maximum: number): string {
  const parsed = requiredString(value, name);
  if (parsed.length > maximum) {
    throw new Error(`Sendblue webhook field ${name} is too long`);
  }
  return parsed;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
