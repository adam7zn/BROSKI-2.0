import { randomUUID } from 'node:crypto';

import type {
  DemoMessageEventInput,
  DemoOutboundReservationInput,
  DemoProfileInput,
} from '@math-study-companion/contracts';

import type { DemoContracts, RuntimeSchema } from './contracts.js';
import { validateWithSchema } from './contracts.js';
import type {
  BackendContext,
  StoredDemoInteraction,
  StoredDemoMessageEvent,
  StoredDemoProfile,
} from './domain.js';
import { AppError } from './errors.js';
import type { DemoInteractionRepository } from './repository.js';

export interface DemoServiceOptions {
  repository: DemoInteractionRepository;
  contracts: DemoContracts;
  contextFixture: BackendContext;
  now?: () => Date;
}

export class DemoService {
  readonly #repository: DemoInteractionRepository;
  readonly #contracts: DemoContracts;
  readonly #contextFixture: BackendContext;
  readonly #now: () => Date;

  constructor(options: DemoServiceOptions) {
    this.#repository = options.repository;
    this.#contracts = options.contracts;
    this.#contextFixture = structuredClone(options.contextFixture);
    this.#now = options.now ?? (() => new Date());
  }

  async start(
    traceId: string,
    interactionId = this.#contextFixture.interactionId,
  ): Promise<StoredDemoInteraction> {
    const contextValidation = validateWithSchema(
      this.#contracts.backendContext,
      { ...this.#contextFixture, interactionId },
    );
    if (!contextValidation.success) {
      throw new AppError(500, {
        code: 'INVALID_BACKEND_CONTEXT',
        message: 'The configured backend context failed contract validation',
        retryable: false,
        traceId,
        details: { issues: contextValidation.issues },
      });
    }

    const record: StoredDemoInteraction = {
      interactionId: contextValidation.data.interactionId,
      traceId,
      context: contextValidation.data,
      result: null,
      startedAt: this.#now().toISOString(),
      completedAt: null,
    };
    const outcome = await this.#repository.create(record);
    if (outcome === 'duplicate') {
      const existing = await this.#repository.findById(record.interactionId);
      throw new AppError(409, {
        code: 'DUPLICATE_INTERACTION',
        message: `Interaction ${record.interactionId} has already been started`,
        retryable: false,
        traceId: existing?.traceId ?? traceId,
        details: { interactionId: record.interactionId },
      });
    }

    return record;
  }

  async submitResult(
    interactionId: string,
    payload: unknown,
    requestTraceId: string,
  ): Promise<StoredDemoInteraction> {
    const validation = validateWithSchema(
      this.#contracts.conversationResult,
      payload,
    );
    if (!validation.success) {
      throw new AppError(400, {
        code: 'INVALID_CONVERSATION_RESULT',
        message: 'Conversation result failed contract validation',
        retryable: false,
        traceId: await this.#traceFor(interactionId, requestTraceId),
        details: { issues: validation.issues },
      });
    }

    if (validation.data.interactionId !== interactionId) {
      throw new AppError(409, {
        code: 'INTERACTION_ID_MISMATCH',
        message: 'Path and payload interaction IDs must match',
        retryable: false,
        traceId: await this.#traceFor(interactionId, requestTraceId),
        details: {
          pathInteractionId: interactionId,
          payloadInteractionId: validation.data.interactionId,
        },
      });
    }

    const completedAt = this.#now().toISOString();
    const outcome = await this.#repository.saveResult(
      interactionId,
      validation.data,
      completedAt,
    );

    if (outcome === 'not_found') throw notFound(interactionId, requestTraceId);
    if (outcome === 'id_mismatch') {
      throw new AppError(409, {
        code: 'INTERACTION_ID_MISMATCH',
        message: 'Path and payload interaction IDs must match',
        retryable: false,
        traceId: await this.#traceFor(interactionId, requestTraceId),
        details: {
          pathInteractionId: interactionId,
          payloadInteractionId: validation.data.interactionId,
        },
      });
    }
    const saved = await this.#repository.findById(interactionId);
    if (!saved) throw notFound(interactionId, requestTraceId);

    if (outcome === 'already_completed') {
      throw new AppError(409, {
        code: 'DUPLICATE_RESULT',
        message: `Interaction ${interactionId} already has a result`,
        retryable: false,
        traceId: saved.traceId,
        details: { interactionId },
      });
    }

    return saved;
  }

  async get(
    interactionId: string,
    requestTraceId: string,
  ): Promise<StoredDemoInteraction> {
    const interaction = await this.#repository.findById(interactionId);
    if (!interaction) throw notFound(interactionId, requestTraceId);
    return interaction;
  }

  async list(): Promise<StoredDemoInteraction[]> {
    return this.#repository.list();
  }

  async saveProfile(
    payload: unknown,
    traceId: string,
  ): Promise<StoredDemoProfile> {
    const profile = this.#validate<DemoProfileInput>(
      this.#contracts.demoProfile,
      payload,
      'INVALID_DEMO_PROFILE',
      'Demo profile failed contract validation',
      traceId,
    );
    const stored: StoredDemoProfile = {
      profileId: 'demo-student',
      ...profile,
      traceId,
      completedAt: this.#now().toISOString(),
    };
    await this.#repository.saveProfile(stored);
    return stored;
  }

  async getProfile(traceId: string): Promise<StoredDemoProfile> {
    const profile = await this.#repository.findProfile();
    if (profile) return profile;
    throw new AppError(404, {
      code: 'DEMO_PROFILE_NOT_FOUND',
      message: 'The demo profile has not been completed',
      retryable: false,
      traceId,
    });
  }

  async findProfile(): Promise<StoredDemoProfile | null> {
    return this.#repository.findProfile();
  }

  async reserveOutbound(
    interactionId: string,
    payload: unknown,
    requestTraceId: string,
  ): Promise<{ outcome: 'reserved' | 'duplicate'; traceId: string }> {
    const input = this.#validate<DemoOutboundReservationInput>(
      this.#contracts.outboundReservation,
      payload,
      'INVALID_OUTBOUND_RESERVATION',
      'Outbound reservation failed contract validation',
      requestTraceId,
    );
    const interaction = await this.get(interactionId, requestTraceId);
    const outcome = await this.#repository.reserveOutbound(
      interactionId,
      input.idempotencyKey,
      interaction.traceId,
      this.#now().toISOString(),
    );
    if (outcome === 'not_found') throw notFound(interactionId, requestTraceId);
    return { outcome, traceId: interaction.traceId };
  }

  async recordMessageEvent(
    interactionId: string,
    payload: unknown,
    requestTraceId: string,
  ): Promise<
    | { outcome: 'recorded'; event: StoredDemoMessageEvent }
    | { outcome: 'duplicate'; traceId: string }
  > {
    const input = this.#validate<DemoMessageEventInput>(
      this.#contracts.messageEvent,
      payload,
      'INVALID_MESSAGE_EVENT',
      'Message event failed contract validation',
      requestTraceId,
    );
    const interaction = await this.get(interactionId, requestTraceId);
    const event: StoredDemoMessageEvent = {
      id: randomUUID(),
      interactionId,
      traceId: interaction.traceId,
      ...input,
      recordedAt: this.#now().toISOString(),
    };
    const outcome = await this.#repository.recordMessageEvent(event);
    if (outcome === 'not_found') throw notFound(interactionId, requestTraceId);
    return outcome === 'recorded'
      ? { outcome, event }
      : { outcome, traceId: interaction.traceId };
  }

  async listMessageEvents(
    interactionId: string,
    requestTraceId: string,
  ): Promise<{ traceId: string; events: StoredDemoMessageEvent[] }> {
    const interaction = await this.get(interactionId, requestTraceId);
    return {
      traceId: interaction.traceId,
      events: await this.#repository.listMessageEvents(interactionId),
    };
  }

  #validate<T>(
    schema: RuntimeSchema<T>,
    payload: unknown,
    code: string,
    message: string,
    traceId: string,
  ): T {
    const validation = validateWithSchema(schema, payload);
    if (validation.success) return validation.data;
    throw new AppError(400, {
      code,
      message,
      retryable: false,
      traceId,
      details: { issues: validation.issues },
    });
  }

  async #traceFor(
    interactionId: string,
    fallbackTraceId: string,
  ): Promise<string> {
    const interaction = await this.#repository.findById(interactionId);
    return interaction?.traceId ?? fallbackTraceId;
  }
}

function notFound(interactionId: string, traceId: string): AppError {
  return new AppError(404, {
    code: 'INTERACTION_NOT_FOUND',
    message: `Interaction ${interactionId} was not found`,
    retryable: false,
    traceId,
    details: { interactionId },
  });
}
