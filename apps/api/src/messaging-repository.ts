import type {
  ConversationAgentOutput,
  DemoMessageEventInput,
} from '@math-study-companion/contracts';
import type { ConversationHistoryItem } from '@math-study-companion/conversation';

import type { DemoInteractionRepository } from './repository.js';

export type MessagingSessionStatus =
  | 'active'
  | 'completed'
  | 'stopped'
  | 'failed';
export type InboundProcessingStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed';
export type OutboundDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'uncertain'
  | 'suppressed';

export interface MessagingSession {
  interactionId: string;
  provider: string;
  participantAddress: string;
  providerLine: string;
  status: MessagingSessionStatus;
  turnNumber: number;
  agentState: unknown;
  lastPromptAt: string | null;
  traceId: string;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboundMessage {
  provider: string;
  providerEventId: string;
  providerMessageId: string;
  interactionId: string;
  turnNumber: number;
  senderAddress: string;
  content: string;
  receivedAt: string;
  processingStatus: InboundProcessingStatus;
  attemptCount: number;
  errorCode: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface OutboundOutboxMessage {
  interactionId: string;
  idempotencyKey: string;
  turnNumber: number;
  purpose: string;
  content: string | null;
  mediaUrl: string | null;
  deliveryStatus: OutboundDeliveryStatus;
  attemptCount: number;
  providerMessageId: string | null;
  acceptedAt: string | null;
  failureCode: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewOutboundIntent {
  interactionId: string;
  idempotencyKey: string;
  turnNumber: number;
  purpose: string;
  content: string | null;
  mediaUrl: string | null;
  traceId: string;
  createdAt: string;
}

export interface HostedMessagingRepository {
  createSession(
    session: MessagingSession,
    outbounds: NewOutboundIntent[],
  ): Promise<'created' | 'duplicate' | 'not_found'>;
  findSession(interactionId: string): Promise<MessagingSession | null>;
  findActiveSession(
    provider: string,
    participantAddress: string,
    providerLine: string,
  ): Promise<MessagingSession | null>;
  findOutboundByProviderMessageId(
    providerMessageId: string,
  ): Promise<OutboundOutboxMessage | null>;
  enqueueInbound(input: {
    message: InboundMessage;
    event: DemoMessageEventInput;
  }): Promise<'queued' | 'duplicate' | 'not_found'>;
  claimInbound(input: {
    now: string;
    staleBefore: string;
  }): Promise<InboundMessage | null>;
  history(interactionId: string): Promise<ConversationHistoryItem[]>;
  completeInbound(input: {
    message: InboundMessage;
    output: ConversationAgentOutput;
    outbounds: NewOutboundIntent[];
    now: string;
  }): Promise<'completed' | 'lost_claim' | 'stale'>;
  discardInbound(input: {
    message: InboundMessage;
    errorCode: string;
    now: string;
  }): Promise<void>;
  failInbound(input: {
    message: InboundMessage;
    errorCode: string;
    now: string;
  }): Promise<void>;
  claimOutbound(input: {
    now: string;
    staleBefore: string;
  }): Promise<OutboundOutboxMessage | null>;
  markOutboundAccepted(input: {
    message: OutboundOutboxMessage;
    providerMessageId: string;
    acceptedAt: string;
    event: DemoMessageEventInput;
    now: string;
  }): Promise<void>;
  markOutboundTerminal(input: {
    message: OutboundOutboxMessage;
    status: 'failed' | 'uncertain' | 'suppressed';
    errorCode: string;
    event?: DemoMessageEventInput;
    now: string;
  }): Promise<void>;
  recordDelivery(input: {
    providerMessageId: string;
    event: DemoMessageEventInput;
    now: string;
  }): Promise<'recorded' | 'duplicate' | 'not_found'>;
  stopSession(input: {
    interactionId: string;
    status: 'stopped' | 'failed';
    failureCode?: string;
    now: string;
  }): Promise<void>;
  listInbound(interactionId: string): Promise<InboundMessage[]>;
  listOutbox(interactionId: string): Promise<OutboundOutboxMessage[]>;
}

export class InMemoryHostedMessagingRepository
  implements HostedMessagingRepository
{
  readonly #sessions = new Map<string, MessagingSession>();
  readonly #inbound = new Map<string, InboundMessage>();
  readonly #outbox = new Map<string, OutboundOutboxMessage>();

  constructor(private readonly interactions: DemoInteractionRepository) {}

  async createSession(
    session: MessagingSession,
    outbounds: NewOutboundIntent[],
  ): Promise<'created' | 'duplicate' | 'not_found'> {
    if (!(await this.interactions.findById(session.interactionId))) {
      return 'not_found';
    }
    if (
      this.#sessions.has(session.interactionId) ||
      [...this.#sessions.values()].some(
        (existing) =>
          existing.status === 'active' &&
          session.status === 'active' &&
          existing.provider === session.provider &&
          existing.participantAddress === session.participantAddress &&
          existing.providerLine === session.providerLine,
      )
    ) {
      return 'duplicate';
    }
    this.#sessions.set(session.interactionId, clone(session));
    this.#insertOutbounds(outbounds);
    return 'created';
  }

  async findSession(interactionId: string): Promise<MessagingSession | null> {
    const value = this.#sessions.get(interactionId);
    return value ? clone(value) : null;
  }

  async findActiveSession(
    provider: string,
    participantAddress: string,
    providerLine: string,
  ): Promise<MessagingSession | null> {
    const value = [...this.#sessions.values()].find(
      (session) =>
        session.status === 'active' &&
        session.provider === provider &&
        session.participantAddress === participantAddress &&
        session.providerLine === providerLine,
    );
    return value ? clone(value) : null;
  }

  async findOutboundByProviderMessageId(
    providerMessageId: string,
  ): Promise<OutboundOutboxMessage | null> {
    const value = [...this.#outbox.values()].find(
      (message) => message.providerMessageId === providerMessageId,
    );
    return value ? clone(value) : null;
  }

  async enqueueInbound(input: {
    message: InboundMessage;
    event: DemoMessageEventInput;
  }): Promise<'queued' | 'duplicate' | 'not_found'> {
    if (!this.#sessions.has(input.message.interactionId)) return 'not_found';
    const key = inboundKey(input.message);
    if (this.#inbound.has(key)) return 'duplicate';
    const outcome = await this.interactions.recordMessageEvent({
      id: `event-${input.message.providerEventId}`,
      interactionId: input.message.interactionId,
      traceId: input.message.traceId,
      ...input.event,
      recordedAt: input.message.createdAt,
    });
    if (outcome === 'duplicate') return 'duplicate';
    if (outcome === 'not_found') return 'not_found';
    this.#inbound.set(key, clone(input.message));
    return 'queued';
  }

  async claimInbound(input: {
    now: string;
    staleBefore: string;
  }): Promise<InboundMessage | null> {
    const candidate = [...this.#inbound.values()]
      .filter(
        (message) =>
          message.processingStatus === 'pending' ||
          (message.processingStatus === 'processing' &&
            message.updatedAt < input.staleBefore),
      )
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))[0];
    if (!candidate) return null;
    const claimed: InboundMessage = {
      ...candidate,
      processingStatus: 'processing',
      attemptCount: candidate.attemptCount + 1,
      updatedAt: input.now,
    };
    this.#inbound.set(inboundKey(claimed), claimed);
    return clone(claimed);
  }

  async history(interactionId: string): Promise<ConversationHistoryItem[]> {
    const inbound = [...this.#inbound.values()]
      .filter(
        (message) =>
          message.interactionId === interactionId &&
          message.processingStatus === 'processed',
      )
      .map((message) => ({
        direction: 'inbound' as const,
        text: message.content,
        occurredAt: message.receivedAt,
      }));
    const outbound = [...this.#outbox.values()]
      .filter(
        (message) =>
          message.interactionId === interactionId &&
          message.content !== null &&
          ['accepted', 'sent', 'delivered'].includes(message.deliveryStatus),
      )
      .map((message) => ({
        direction: 'outbound' as const,
        text: message.content!,
        occurredAt: message.acceptedAt ?? message.createdAt,
      }));
    return [...inbound, ...outbound].sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt),
    );
  }

  async completeInbound(input: {
    message: InboundMessage;
    output: ConversationAgentOutput;
    outbounds: NewOutboundIntent[];
    now: string;
  }): Promise<'completed' | 'lost_claim' | 'stale'> {
    const key = inboundKey(input.message);
    const current = this.#inbound.get(key);
    if (
      !current ||
      current.processingStatus !== 'processing' ||
      current.attemptCount !== input.message.attemptCount
    ) {
      return 'lost_claim';
    }
    const session = this.#sessions.get(input.message.interactionId);
    if (
      !session ||
      session.status !== 'active' ||
      session.turnNumber !== input.message.turnNumber
    ) {
      this.#inbound.set(key, {
        ...current,
        processingStatus: 'failed',
        errorCode: 'STALE_INBOUND_TURN',
        updatedAt: input.now,
      });
      return 'stale';
    }
    if (input.output.profile) {
      await this.interactions.saveProfile({
        profileId: 'demo-student',
        ...input.output.profile,
        traceId: input.message.traceId,
        completedAt: input.now,
      });
    }
    if (input.output.result) {
      await this.interactions.saveResult(
        input.message.interactionId,
        input.output.result,
        input.now,
      );
    }
    this.#sessions.set(session.interactionId, {
      ...session,
      status:
        input.output.status === 'waiting'
          ? 'active'
          : input.output.status === 'completed'
            ? 'completed'
            : 'stopped',
      turnNumber: session.turnNumber + 1,
      agentState: structuredClone(input.output.agentState),
      updatedAt: input.now,
    });
    this.#insertOutbounds(input.outbounds);
    this.#inbound.set(key, {
      ...current,
      processingStatus: 'processed',
      processedAt: input.now,
      updatedAt: input.now,
    });
    return 'completed';
  }

  async discardInbound(input: {
    message: InboundMessage;
    errorCode: string;
    now: string;
  }): Promise<void> {
    const key = inboundKey(input.message);
    const current = this.#inbound.get(key);
    if (
      !current ||
      current.processingStatus !== 'processing' ||
      current.attemptCount !== input.message.attemptCount
    ) {
      return;
    }
    this.#inbound.set(key, {
      ...current,
      processingStatus: 'failed',
      errorCode: input.errorCode,
      updatedAt: input.now,
    });
  }

  async failInbound(input: {
    message: InboundMessage;
    errorCode: string;
    now: string;
  }): Promise<void> {
    const key = inboundKey(input.message);
    const current = this.#inbound.get(key);
    if (!current) return;
    this.#inbound.set(key, {
      ...current,
      processingStatus: 'failed',
      errorCode: input.errorCode,
      updatedAt: input.now,
    });
    await this.stopSession({
      interactionId: current.interactionId,
      status: 'failed',
      failureCode: input.errorCode,
      now: input.now,
    });
  }

  async claimOutbound(input: {
    now: string;
    staleBefore: string;
  }): Promise<OutboundOutboxMessage | null> {
    const candidate = [...this.#outbox.values()]
      .filter(
        (message) =>
          message.deliveryStatus === 'pending' ||
          (message.deliveryStatus === 'processing' &&
            message.updatedAt < input.staleBefore),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!candidate) return null;
    const claimed: OutboundOutboxMessage = {
      ...candidate,
      deliveryStatus: 'processing',
      attemptCount: candidate.attemptCount + 1,
      updatedAt: input.now,
    };
    this.#outbox.set(outboundKey(claimed), claimed);
    return clone(claimed);
  }

  async markOutboundAccepted(input: {
    message: OutboundOutboxMessage;
    providerMessageId: string;
    acceptedAt: string;
    event: DemoMessageEventInput;
    now: string;
  }): Promise<void> {
    this.#outbox.set(outboundKey(input.message), {
      ...input.message,
      deliveryStatus: 'accepted',
      providerMessageId: input.providerMessageId,
      acceptedAt: input.acceptedAt,
      updatedAt: input.now,
    });
    const session = this.#sessions.get(input.message.interactionId)!;
    this.#sessions.set(session.interactionId, {
      ...session,
      lastPromptAt: input.acceptedAt,
      updatedAt: input.now,
    });
    await this.interactions.recordMessageEvent({
      id: `event-${input.providerMessageId}`,
      interactionId: input.message.interactionId,
      traceId: input.message.traceId,
      ...input.event,
      recordedAt: input.now,
    });
  }

  async markOutboundTerminal(input: {
    message: OutboundOutboxMessage;
    status: 'failed' | 'uncertain' | 'suppressed';
    errorCode: string;
    event?: DemoMessageEventInput;
    now: string;
  }): Promise<void> {
    this.#outbox.set(outboundKey(input.message), {
      ...input.message,
      deliveryStatus: input.status,
      failureCode: input.errorCode,
      updatedAt: input.now,
    });
    if (input.event) {
      await this.interactions.recordMessageEvent({
        id: `event-${input.message.idempotencyKey}-${input.status}`,
        interactionId: input.message.interactionId,
        traceId: input.message.traceId,
        ...input.event,
        recordedAt: input.now,
      });
    }
    if (input.status !== 'suppressed') {
      await this.stopSession({
        interactionId: input.message.interactionId,
        status: 'failed',
        failureCode: input.errorCode,
        now: input.now,
      });
    }
  }

  async recordDelivery(input: {
    providerMessageId: string;
    event: DemoMessageEventInput;
    now: string;
  }): Promise<'recorded' | 'duplicate' | 'not_found'> {
    const message = [...this.#outbox.values()].find(
      (value) => value.providerMessageId === input.providerMessageId,
    );
    if (!message) return 'not_found';
    const outcome = await this.interactions.recordMessageEvent({
      id: `event-${input.event.providerEventId}`,
      interactionId: message.interactionId,
      traceId: message.traceId,
      ...input.event,
      recordedAt: input.now,
    });
    if (outcome !== 'recorded') return outcome;
    this.#outbox.set(outboundKey(message), {
      ...message,
      deliveryStatus: nextDeliveryStatus(
        message.deliveryStatus,
        input.event.eventType,
      ),
      failureCode:
        input.event.eventType === 'failed'
          ? 'SENDBLUE_ERROR'
          : message.failureCode,
      updatedAt: input.now,
    });
    if (input.event.eventType === 'failed') {
      await this.stopSession({
        interactionId: message.interactionId,
        status: 'failed',
        failureCode: 'SENDBLUE_ERROR',
        now: input.now,
      });
    }
    return 'recorded';
  }

  async stopSession(input: {
    interactionId: string;
    status: 'stopped' | 'failed';
    failureCode?: string;
    now: string;
  }): Promise<void> {
    const session = this.#sessions.get(input.interactionId);
    if (!session) return;
    this.#sessions.set(session.interactionId, {
      ...session,
      status: input.status,
      failureCode:
        input.status === 'failed'
          ? (input.failureCode ?? 'MESSAGING_FAILED')
          : null,
      updatedAt: input.now,
    });
  }

  async listInbound(interactionId: string): Promise<InboundMessage[]> {
    return [...this.#inbound.values()]
      .filter((value) => value.interactionId === interactionId)
      .map(clone);
  }

  async listOutbox(interactionId: string): Promise<OutboundOutboxMessage[]> {
    return [...this.#outbox.values()]
      .filter((value) => value.interactionId === interactionId)
      .map(clone);
  }

  #insertOutbounds(values: NewOutboundIntent[]): void {
    for (const value of values) {
      const key = outboundKey(value);
      if (this.#outbox.has(key)) continue;
      this.#outbox.set(key, {
        ...value,
        deliveryStatus: 'pending',
        attemptCount: 0,
        providerMessageId: null,
        acceptedAt: null,
        failureCode: null,
        updatedAt: value.createdAt,
      });
    }
  }
}

function inboundKey(value: Pick<InboundMessage, 'provider' | 'providerEventId'>) {
  return `${value.provider}:${value.providerEventId}`;
}

function outboundKey(
  value: Pick<OutboundOutboxMessage, 'interactionId' | 'idempotencyKey'>,
) {
  return `${value.interactionId}:${value.idempotencyKey}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nextDeliveryStatus(
  current: OutboundDeliveryStatus,
  eventType: DemoMessageEventInput['eventType'],
): OutboundDeliveryStatus {
  if (['failed', 'uncertain', 'suppressed'].includes(current)) return current;
  if (eventType === 'failed') return 'failed';
  if (current === 'delivered') return current;
  return eventType === 'delivered' ? 'delivered' : 'sent';
}
