import type { DemoContracts } from './contracts.js';
import { validateWithSchema } from './contracts.js';
import type { BackendContext, StoredDemoInteraction } from './domain.js';
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

  async start(traceId: string): Promise<StoredDemoInteraction> {
    const contextValidation = validateWithSchema(
      this.#contracts.backendContext,
      this.#contextFixture,
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
