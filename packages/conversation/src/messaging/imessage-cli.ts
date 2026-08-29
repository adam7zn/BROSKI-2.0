import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UnsupportedMediaError } from './port.js';
import type {
  InboundMessageEvent,
  InboundSource,
  MessagingProvider,
  OutboundImage,
  OutboundText,
  SendResult,
} from './port.js';

export interface CommandResult {
  stdout: string;
}

export interface IMessageCommandRunner {
  run(args: string[]): Promise<CommandResult>;
}

export interface IMessageCliOptions {
  binary?: string;
  recipient: string;
  pollIntervalMs?: number;
  commandRunner?: IMessageCommandRunner;
  now?: () => Date;
}

interface CliMessage {
  id: string;
  text: string;
  timestamp: number;
  isSender: boolean;
  senderId: string;
  threadId: string;
}

export class IMessageCliProvider implements MessagingProvider, InboundSource {
  readonly name = 'imessage-cli';
  readonly #recipient: string;
  readonly #pollIntervalMs: number;
  readonly #runner: IMessageCommandRunner;
  readonly #now: () => Date;

  constructor(options: IMessageCliOptions) {
    this.#recipient = options.recipient;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#runner =
      options.commandRunner ??
      new ExecFileCommandRunner(options.binary ?? 'imessage-cli');
    this.#now = options.now ?? (() => new Date());
  }

  async verify(): Promise<void> {
    const result = await this.#runner.run(['--json', 'current-user']);
    const value = parseJson(result.stdout);
    if (!isRecord(value)) {
      throw new Error('imessage-cli did not return a current user');
    }
  }

  async sendMessage(input: OutboundText): Promise<SendResult> {
    this.#assertConversation(input.conversationId);
    const result = await this.#runner.run([
      '--json',
      'send',
      this.#recipient,
      input.text,
    ]);
    const value = parseJson(result.stdout);
    let message = firstMessage(value);
    if (!message && value === true) {
      message = await this.#findRecentOutbound(input.text);
    }
    if (!message) {
      throw new Error('imessage-cli accepted no identifiable outbound message');
    }
    return {
      providerMessageId: message.id,
      acceptedAt: timestampToIso(message.timestamp, this.#now()),
      deduplicated: false,
    };
  }

  async sendImage(input: OutboundImage): Promise<SendResult> {
    this.#assertConversation(input.conversationId);
    if (input.media.kind !== 'file') {
      throw new UnsupportedMediaError(this.name, input.media.kind);
    }
    const mediaPath = input.media.path.startsWith('file:')
      ? fileURLToPath(input.media.path)
      : input.media.path;
    if (!isAbsolute(mediaPath)) {
      throw new Error('iMessage image references must be absolute local paths');
    }
    await this.#runner.run(['--json', 'send-file', this.#recipient, mediaPath]);
    return this.sendMessage({
      conversationId: input.conversationId,
      text: input.caption ?? input.altText,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async *listen(
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<InboundMessageEvent> {
    const startedAt = this.#now().getTime();
    const seen = new Set<string>();

    while (!options.signal?.aborted) {
      const messages = await this.#readMessages();
      for (const message of messages.sort(
        (left, right) => left.timestamp - right.timestamp,
      )) {
        if (
          seen.has(message.id) ||
          message.isSender ||
          message.timestamp < startedAt ||
          !message.text.trim() ||
          !this.#belongsToRecipient(message)
        ) {
          continue;
        }
        seen.add(message.id);
        yield {
          provider: this.name,
          providerEventId: message.id,
          providerMessageId: message.id,
          providerConversationId: this.#recipient,
          senderAddress: message.senderId || this.#recipient,
          text: message.text,
          receivedAt: timestampToIso(message.timestamp, this.#now()),
          // The CLI reads text messages only; attachments arrive as nothing.
          attachments: [],
        };
      }
      await abortableDelay(this.#pollIntervalMs, options.signal);
    }
  }

  async #readMessages(): Promise<CliMessage[]> {
    const result = await this.#runner.run([
      '--json',
      'messages',
      this.#recipient,
    ]);
    return messageItems(parseJson(result.stdout)).flatMap(toCliMessage);
  }

  async #findRecentOutbound(text: string): Promise<CliMessage | null> {
    const earliest = this.#now().getTime() - 30_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const match = (await this.#readMessages()).find(
        (message) =>
          message.isSender &&
          message.text === text &&
          message.timestamp >= earliest,
      );
      if (match) return match;
      await abortableDelay(300);
    }
    return null;
  }

  #assertConversation(conversationId: string): void {
    if (
      normalizeAddress(conversationId) !== normalizeAddress(this.#recipient)
    ) {
      throw new Error('Refusing to use an unconfigured iMessage conversation');
    }
  }

  #belongsToRecipient(message: CliMessage): boolean {
    const recipient = normalizeAddress(this.#recipient);
    const sender = normalizeAddress(message.senderId);
    const thread = normalizeAddress(message.threadId);
    const correctThread = thread.length === 0 || thread.includes(recipient);
    const correctSender =
      sender.length > 0 ? sender === recipient : thread.includes(recipient);
    return correctThread && correctSender;
  }
}

export class ExecFileCommandRunner implements IMessageCommandRunner {
  constructor(private readonly binary: string) {}

  run(args: string[]): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        this.binary,
        args,
        { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(
              new Error(
                `imessage-cli command failed (${error.code ?? 'unknown'})`,
                { cause: error },
              ),
            );
            return;
          }
          resolve({ stdout });
        },
      );
    });
  }
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim()) as unknown;
  } catch (error) {
    throw new Error('imessage-cli returned malformed JSON', { cause: error });
  }
}

function messageItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.items)) return value.items;
  return [];
}

function firstMessage(value: unknown): CliMessage | null {
  return messageItems(value).flatMap(toCliMessage)[0] ?? null;
}

function toCliMessage(value: unknown): CliMessage[] {
  if (!isRecord(value)) return [];
  const id = stringValue(value.id);
  const timestamp = numberValue(value.timestamp);
  if (!id || timestamp === null) return [];
  return [
    {
      id,
      timestamp,
      text: stringValue(value.text) ?? '',
      isSender: value.isSender === true,
      senderId: stringValue(value.senderID) ?? '',
      threadId: stringValue(value.threadID) ?? '',
    },
  ];
}

function timestampToIso(timestamp: number, fallback: Date): string {
  const milliseconds =
    timestamp > 10_000_000_000 ? timestamp : timestamp * 1_000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime())
    ? fallback.toISOString()
    : date.toISOString();
}

function normalizeAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(any|imessage|sms|rcs);[-+];/, '')
    .replace(/[\s()-]/g, '');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
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
