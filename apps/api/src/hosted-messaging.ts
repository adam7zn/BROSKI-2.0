import {
  conversationAgentOutputSchema,
  type AgentOutboundIntent,
  type ConversationAgentOutput,
} from '@math-study-companion/contracts';
import {
  normalizeSendblueWebhook,
  SendblueError,
  verifySendblueWebhookSecret,
  type ConversationAgent,
  type MessagingProvider,
  type SendblueServiceAvailability,
} from '@math-study-companion/conversation';

import { AppError } from './errors.js';
import type { Logger } from './logger.js';
import { jsonLogger } from './logger.js';
import type {
  HostedMessagingRepository,
  InboundMessage,
  MessagingSession,
  NewOutboundIntent,
  OutboundOutboxMessage,
} from './messaging-repository.js';
import type { DemoService } from './service.js';

const providerName = 'sendblue';
const defaultClaimTimeoutMs = 60_000;

export interface HostedMessagingOptions {
  service: DemoService;
  repository: HostedMessagingRepository;
  provider: HostedMessagingProvider;
  agent: ConversationAgent;
  webhookSecret: string;
  participantAddress: string;
  providerLine: string;
  liveEnabled: boolean;
  logger?: Logger;
  now?: () => Date;
  claimTimeoutMs?: number;
}

export interface HostedMessagingProvider extends MessagingProvider {
  checkServiceAvailability(): Promise<SendblueServiceAvailability>;
}

export interface WebhookIngestResult {
  outcome: 'queued' | 'duplicate' | 'ignored' | 'recorded';
  reason?: string;
}

export class HostedMessagingService {
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #claimTimeoutMs: number;

  constructor(readonly options: HostedMessagingOptions) {
    if (!options.webhookSecret) {
      throw new Error('SENDBLUE_WEBHOOK_SECRET is required');
    }
    if (options.provider.name !== providerName) {
      throw new Error('The hosted runtime requires the Sendblue provider');
    }
    this.#logger = options.logger ?? jsonLogger;
    this.#now = options.now ?? (() => new Date());
    this.#claimTimeoutMs = options.claimTimeoutMs ?? defaultClaimTimeoutMs;
  }

  async status(verifyProvider: boolean, traceId: string) {
    if (!verifyProvider) {
      return {
        provider: providerName,
        liveEnabled: this.options.liveEnabled,
        availability: null,
      };
    }
    try {
      return {
        provider: providerName,
        liveEnabled: this.options.liveEnabled,
        availability: await this.options.provider.checkServiceAvailability(),
      };
    } catch (error) {
      const kind = error instanceof SendblueError ? error.kind : 'unexpected';
      throw new AppError(503, {
        code: `SENDBLUE_SERVICE_${kind.toUpperCase()}`,
        message: 'Sendblue service availability could not be confirmed',
        retryable:
          error instanceof SendblueError &&
          ['network', 'rate_limited', 'timeout'].includes(error.kind),
        traceId,
      });
    }
  }

  authenticateWebhook(
    suppliedSecret: string | undefined,
    traceId: string,
  ): void {
    if (
      !verifySendblueWebhookSecret(suppliedSecret, this.options.webhookSecret)
    ) {
      throw new AppError(401, {
        code: 'INVALID_WEBHOOK_AUTHENTICATION',
        message: 'Webhook authentication failed',
        retryable: false,
        traceId,
      });
    }
  }

  async launch(
    interactionId: string,
    traceId: string,
  ): Promise<MessagingSession> {
    const interaction = await this.options.service.get(interactionId, traceId);
    if (interaction.result !== null) {
      throw new AppError(409, {
        code: 'INTERACTION_ALREADY_COMPLETED',
        message: `Interaction ${interactionId} is already complete`,
        retryable: false,
        traceId: interaction.traceId,
      });
    }
    const [profile, exercise] = await Promise.all([
      this.options.service.findProfile(),
      this.options.service.findVerifiedExerciseForInteraction(
        interactionId,
        interaction.traceId,
      ),
    ]);
    const output = validateAgentOutput(
      await this.options.agent.startSession({
        context: interaction.context,
        profile,
        exercise,
        traceId: interaction.traceId,
      }),
      interaction.traceId,
      interactionId,
    );
    if (output.profile !== null || output.result !== null) {
      throw agentOutputError(
        interaction.traceId,
        'Session-start output cannot contain profile or result updates',
      );
    }

    const now = this.#now().toISOString();
    const session: MessagingSession = {
      interactionId,
      provider: providerName,
      participantAddress: this.options.participantAddress,
      providerLine: this.options.providerLine,
      status:
        output.status === 'waiting'
          ? 'active'
          : output.status === 'completed'
            ? 'completed'
            : 'stopped',
      turnNumber: 0,
      agentState: output.agentState,
      lastPromptAt: null,
      traceId: interaction.traceId,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    };
    const outcome = await this.options.repository.createSession(
      session,
      toOutbounds(interactionId, 0, output.outbound, interaction.traceId, now),
    );
    if (outcome === 'duplicate') {
      throw new AppError(409, {
        code: 'MESSAGING_SESSION_EXISTS',
        message: `Messaging session ${interactionId} already exists`,
        retryable: false,
        traceId: interaction.traceId,
      });
    }
    if (outcome === 'not_found') {
      throw new AppError(404, {
        code: 'INTERACTION_NOT_FOUND',
        message: `Interaction ${interactionId} was not found`,
        retryable: false,
        traceId,
      });
    }
    return session;
  }

  async stopInteraction(
    interactionId: string,
    traceId: string,
  ): Promise<MessagingSession> {
    const session = await this.options.repository.findSession(interactionId);
    if (!session) {
      throw new AppError(404, {
        code: 'MESSAGING_SESSION_NOT_FOUND',
        message: `Messaging session ${interactionId} was not found`,
        retryable: false,
        traceId,
      });
    }
    if (session.status === 'active') {
      await this.options.repository.stopSession({
        interactionId,
        status: 'stopped',
        now: this.#now().toISOString(),
      });
    }
    return { ...session, status: 'stopped', updatedAt: this.#now().toISOString() };
  }

  async ingestWebhook(
    payload: unknown,
    suppliedSecret: string | undefined,
    traceId: string,
  ): Promise<WebhookIngestResult> {
    this.authenticateWebhook(suppliedSecret, traceId);

    let normalized: ReturnType<typeof normalizeSendblueWebhook>;
    try {
      normalized = normalizeSendblueWebhook(payload);
    } catch {
      throw new AppError(400, {
        code: 'INVALID_SENDBLUE_WEBHOOK',
        message: 'Sendblue webhook payload failed validation',
        retryable: false,
        traceId,
      });
    }

    if (normalized.kind === 'ignored') {
      return { outcome: 'ignored', reason: normalized.reason };
    }

    if (normalized.kind === 'delivery') {
      if (
        normalizePhone(normalized.senderAddress) !==
          normalizePhone(this.options.providerLine) ||
        normalizePhone(normalized.recipientAddress) !==
          normalizePhone(this.options.participantAddress)
      ) {
        return { outcome: 'ignored', reason: 'not-allowlisted' };
      }
      const outbox =
        await this.options.repository.findOutboundByProviderMessageId(
          normalized.providerMessageId,
        );
      if (!outbox) {
        return { outcome: 'ignored', reason: 'unknown-outbound-message' };
      }
      const failed =
        normalized.optedOut ||
        normalized.downgraded ||
        normalized.service.toLowerCase() !== 'imessage' ||
        normalized.eventType === 'failed';
      const failureCode = normalized.optedOut
        ? 'SENDBLUE_OPT_OUT'
        : normalized.downgraded ||
            normalized.service.toLowerCase() !== 'imessage'
          ? 'SENDBLUE_SMS_DOWNGRADE'
          : normalized.eventType === 'failed'
            ? 'SENDBLUE_ERROR'
            : undefined;
      const outcome = await this.options.repository.recordDelivery({
        providerMessageId: normalized.providerMessageId,
        event: {
          provider: providerName,
          direction: 'outbound',
          eventType: failed ? 'failed' : normalized.eventType,
          providerEventId: normalized.providerEventId,
          providerMessageId: normalized.providerMessageId,
          idempotencyKey: outbox.idempotencyKey,
          occurredAt: normalized.occurredAt,
        },
        ...(failureCode ? { failureCode } : {}),
        now: this.#now().toISOString(),
      });
      return outcome === 'not_found'
        ? { outcome: 'ignored', reason: 'unknown-outbound-message' }
        : { outcome };
    }

    if (
      normalizePhone(normalized.senderAddress) !==
        normalizePhone(this.options.participantAddress) ||
      normalizePhone(normalized.recipientAddress) !==
        normalizePhone(this.options.providerLine)
    ) {
      return { outcome: 'ignored', reason: 'not-allowlisted' };
    }

    const session = await this.options.repository.findActiveSession(
      providerName,
      this.options.participantAddress,
      this.options.providerLine,
    );
    if (!session) return { outcome: 'ignored', reason: 'no-active-session' };

    const receivedAt = normalized.occurredAt;
    const invalidReason = normalized.optedOut
      ? 'SENDBLUE_OPT_OUT'
      : normalized.downgraded || normalized.service.toLowerCase() !== 'imessage'
        ? 'SENDBLUE_SMS_DOWNGRADE'
        : !normalized.text
          ? 'EMPTY_MESSAGE'
          : session.lastPromptAt === null ||
              Date.parse(receivedAt) <= Date.parse(session.lastPromptAt)
            ? 'PRE_PROMPT_MESSAGE'
            : null;
    const now = this.#now().toISOString();
    const message: InboundMessage = {
      provider: providerName,
      providerEventId: normalized.providerEventId,
      providerMessageId: normalized.providerMessageId,
      interactionId: session.interactionId,
      turnNumber: session.turnNumber,
      senderAddress: normalized.senderAddress,
      content: normalized.text,
      receivedAt,
      processingStatus: invalidReason === null ? 'pending' : 'failed',
      attemptCount: 0,
      errorCode: invalidReason,
      traceId: session.traceId,
      createdAt: now,
      updatedAt: now,
      processedAt: null,
    };
    const outcome = await this.options.repository.enqueueInbound({
      message,
      event: {
        provider: providerName,
        direction: 'inbound',
        eventType: 'received',
        providerEventId: normalized.providerEventId,
        providerMessageId: normalized.providerMessageId,
        idempotencyKey: null,
        occurredAt: receivedAt,
      },
    });
    if (
      outcome === 'queued' &&
      (invalidReason === 'SENDBLUE_OPT_OUT' ||
        invalidReason === 'SENDBLUE_SMS_DOWNGRADE')
    ) {
      await this.options.repository.stopSession({
        interactionId: session.interactionId,
        status: invalidReason === 'SENDBLUE_OPT_OUT' ? 'stopped' : 'failed',
        failureCode: invalidReason,
        now,
      });
    }
    if (outcome === 'not_found') {
      return { outcome: 'ignored', reason: 'no-active-session' };
    }
    if (outcome === 'duplicate') return { outcome: 'duplicate' };
    if (invalidReason !== null) {
      return { outcome: 'ignored', reason: invalidReason.toLowerCase() };
    }
    return { outcome: 'queued' };
  }

  async inspect(interactionId: string, traceId: string) {
    await this.options.service.get(interactionId, traceId);
    const [session, inbound, outbox] = await Promise.all([
      this.options.repository.findSession(interactionId),
      this.options.repository.listInbound(interactionId),
      this.options.repository.listOutbox(interactionId),
    ]);
    const sessionMetadata = (() => {
      if (!session) return null;
      const { agentState, participantAddress, providerLine, ...metadata } =
        session;
      void agentState;
      void participantAddress;
      void providerLine;
      return metadata;
    })();
    return {
      session: sessionMetadata,
      inbound: inbound.map(({ content, senderAddress, ...metadata }) => {
        void content;
        void senderAddress;
        return metadata;
      }),
      outbox: outbox.map(({ content, ...metadata }) => {
        void content;
        return metadata;
      }),
    };
  }

  createWorker(): HostedMessageWorker {
    return new HostedMessageWorker({
      ...this.options,
      logger: this.#logger,
      now: this.#now,
      claimTimeoutMs: this.#claimTimeoutMs,
    });
  }
}

interface WorkerOptions extends HostedMessagingOptions {
  logger: Logger;
  now: () => Date;
  claimTimeoutMs: number;
}

export class HostedMessageWorker {
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<void> | null = null;

  constructor(private readonly options: WorkerOptions) {}

  start(pollIntervalMs = 1_000): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.wake(), pollIntervalMs);
    this.#timer.unref();
    this.wake();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#running;
  }

  wake(): void {
    if (this.#running) return;
    this.#running = this.processAvailable()
      .catch(() => {
        this.options.logger.write({
          level: 'error',
          event: 'messaging.worker_failed',
          traceId: 'worker',
          status: 500,
          code: 'MESSAGING_WORKER_FAILED',
        });
      })
      .finally(() => {
        this.#running = null;
      });
  }

  async processAvailable(limit = 20): Promise<void> {
    for (let processed = 0; processed < limit; processed += 1) {
      const outbound = await this.#claimOutbound();
      if (outbound) {
        await this.#processOutbound(outbound);
        continue;
      }
      const inbound = await this.#claimInbound();
      if (!inbound) return;
      await this.#processInbound(inbound);
    }
  }

  async #claimInbound(): Promise<InboundMessage | null> {
    const now = this.options.now();
    return this.options.repository.claimInbound({
      now: now.toISOString(),
      staleBefore: new Date(
        now.getTime() - this.options.claimTimeoutMs,
      ).toISOString(),
    });
  }

  async #claimOutbound(): Promise<OutboundOutboxMessage | null> {
    const now = this.options.now();
    return this.options.repository.claimOutbound({
      now: now.toISOString(),
      staleBefore: new Date(
        now.getTime() - this.options.claimTimeoutMs,
      ).toISOString(),
    });
  }

  async #processInbound(message: InboundMessage): Promise<void> {
    try {
      const [session, interaction, history, exercise] = await Promise.all([
        this.options.repository.findSession(message.interactionId),
        this.options.service.get(message.interactionId, message.traceId),
        this.options.repository.history(message.interactionId),
        this.options.service.findVerifiedExerciseForInteraction(
          message.interactionId,
          message.traceId,
        ),
      ]);
      if (!session || session.status !== 'active') {
        await this.options.repository.discardInbound({
          message,
          errorCode: 'SESSION_NOT_ACTIVE',
          now: this.options.now().toISOString(),
        });
        return;
      }
      if (session.turnNumber !== message.turnNumber) {
        await this.options.repository.discardInbound({
          message,
          errorCode: 'STALE_INBOUND_TURN',
          now: this.options.now().toISOString(),
        });
        return;
      }
      const output = validateAgentOutput(
        await this.options.agent.handleInbound({
          interactionId: message.interactionId,
          context: interaction.context,
          text: message.content,
          receivedAt: message.receivedAt,
          history,
          agentState: session.agentState,
          traceId: session.traceId,
          exercise,
        }),
        session.traceId,
        message.interactionId,
      );
      const now = this.options.now().toISOString();
      await this.options.repository.completeInbound({
        message,
        output,
        outbounds: toOutbounds(
          message.interactionId,
          session.turnNumber + 1,
          output.outbound,
          session.traceId,
          now,
        ),
        now,
      });
    } catch {
      const now = this.options.now().toISOString();
      await this.options.repository.failInbound({
        message,
        errorCode: 'AGENT_PROCESSING_FAILED',
        now,
      });
      this.options.logger.write({
        level: 'error',
        event: 'messaging.inbound_failed',
        traceId: message.traceId,
        interactionId: message.interactionId,
        status: 500,
        code: 'AGENT_PROCESSING_FAILED',
      });
    }
  }

  async #processOutbound(message: OutboundOutboxMessage): Promise<void> {
    const now = this.options.now().toISOString();
    if (!this.options.liveEnabled) {
      await this.options.repository.markOutboundTerminal({
        message,
        status: 'suppressed',
        errorCode: 'MESSAGING_LIVE_DISABLED',
        now,
      });
      return;
    }

    try {
      const reservation = await this.options.service.reserveOutbound(
        message.interactionId,
        { idempotencyKey: message.idempotencyKey },
        message.traceId,
      );
      if (reservation.outcome === 'duplicate') {
        await this.options.repository.markOutboundTerminal({
          message,
          status: 'uncertain',
          errorCode: 'DUPLICATE_OUTBOUND_RESERVATION',
          now,
        });
        return;
      }

      const result = message.mediaUrl
        ? await this.options.provider.sendImage({
            conversationId: this.options.participantAddress,
            media: { kind: 'url', url: message.mediaUrl },
            altText: message.purpose,
            ...(message.content ? { caption: message.content } : {}),
            idempotencyKey: message.idempotencyKey,
          })
        : await this.options.provider.sendMessage({
            conversationId: this.options.participantAddress,
            text: message.content!,
            idempotencyKey: message.idempotencyKey,
          });
      await this.options.repository.markOutboundAccepted({
        message,
        providerMessageId: result.providerMessageId,
        acceptedAt: result.acceptedAt,
        event: {
          provider: providerName,
          direction: 'outbound',
          eventType: 'accepted',
          providerEventId: result.providerMessageId,
          providerMessageId: result.providerMessageId,
          idempotencyKey: message.idempotencyKey,
          occurredAt: result.acceptedAt,
        },
        now: this.options.now().toISOString(),
      });
    } catch (error) {
      const uncertain =
        error instanceof SendblueError ? error.deliveryUncertain : true;
      const errorCode =
        error instanceof SendblueError
          ? `SENDBLUE_${error.kind.toUpperCase()}`
          : 'SENDBLUE_UNEXPECTED_FAILURE';
      await this.options.repository.markOutboundTerminal({
        message,
        status: uncertain ? 'uncertain' : 'failed',
        errorCode,
        ...(uncertain
          ? {}
          : {
              event: {
                provider: providerName,
                direction: 'outbound' as const,
                eventType: 'failed' as const,
                providerEventId: null,
                providerMessageId: null,
                idempotencyKey: message.idempotencyKey,
                occurredAt: this.options.now().toISOString(),
              },
            }),
        now: this.options.now().toISOString(),
      });
    }
  }
}

function validateAgentOutput(
  value: unknown,
  traceId: string,
  interactionId: string,
): ConversationAgentOutput {
  const parsed = conversationAgentOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw agentOutputError(
      traceId,
      'Conversation agent output failed validation',
    );
  }
  if (
    parsed.data.result !== null &&
    parsed.data.result.interactionId !== interactionId
  ) {
    throw agentOutputError(
      traceId,
      'Conversation agent result interaction ID does not match the session',
    );
  }
  if (
    (parsed.data.result !== null && parsed.data.status !== 'completed') ||
    (parsed.data.result === null && parsed.data.status === 'completed')
  ) {
    throw agentOutputError(
      traceId,
      'Conversation agent completion status and result are inconsistent',
    );
  }
  return parsed.data;
}

function agentOutputError(traceId: string, message: string): AppError {
  return new AppError(500, {
    code: 'INVALID_AGENT_OUTPUT',
    message,
    retryable: false,
    traceId,
  });
}

function toOutbounds(
  interactionId: string,
  turnNumber: number,
  intents: AgentOutboundIntent[],
  traceId: string,
  createdAt: string,
): NewOutboundIntent[] {
  return intents.map((intent, index) => ({
    interactionId,
    idempotencyKey: stableIdempotencyKey(interactionId, turnNumber, index),
    turnNumber,
    purpose: intent.purpose,
    content: intent.text,
    mediaUrl: intent.mediaUrl,
    traceId,
    createdAt,
  }));
}

export function stableIdempotencyKey(
  interactionId: string,
  turnNumber: number,
  index: number,
): string {
  return `${interactionId}:turn:${turnNumber}:intent:${String(index).padStart(2, '0')}`;
}

function normalizePhone(value: string): string {
  return value.replace(/[\s()-]/g, '');
}
