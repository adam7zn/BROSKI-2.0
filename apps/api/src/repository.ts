import type {
  ConversationResult,
  StoredDemoInteraction,
  StoredDemoMessageEvent,
  StoredDemoProfile,
} from './domain.js';

export type CreateOutcome = 'created' | 'duplicate';
export type SaveResultOutcome =
  'saved' | 'not_found' | 'already_completed' | 'id_mismatch';
export type ReserveOutboundOutcome = 'reserved' | 'duplicate' | 'not_found';
export type RecordMessageEventOutcome = 'recorded' | 'duplicate' | 'not_found';

export interface DemoInteractionRepository {
  create(interaction: StoredDemoInteraction): Promise<CreateOutcome>;
  findById(interactionId: string): Promise<StoredDemoInteraction | null>;
  list(): Promise<StoredDemoInteraction[]>;
  saveResult(
    interactionId: string,
    result: ConversationResult,
    completedAt: string,
  ): Promise<SaveResultOutcome>;
  saveProfile(profile: StoredDemoProfile): Promise<void>;
  findProfile(): Promise<StoredDemoProfile | null>;
  reserveOutbound(
    interactionId: string,
    idempotencyKey: string,
    traceId: string,
    reservedAt: string,
  ): Promise<ReserveOutboundOutcome>;
  recordMessageEvent(
    event: StoredDemoMessageEvent,
  ): Promise<RecordMessageEventOutcome>;
  listMessageEvents(interactionId: string): Promise<StoredDemoMessageEvent[]>;
}

export class InMemoryDemoInteractionRepository implements DemoInteractionRepository {
  readonly #interactions = new Map<string, StoredDemoInteraction>();
  readonly #events = new Map<string, StoredDemoMessageEvent[]>();
  readonly #eventKeys = new Set<string>();
  readonly #reservations = new Set<string>();
  #profile: StoredDemoProfile | null = null;

  async create(interaction: StoredDemoInteraction): Promise<CreateOutcome> {
    if (this.#interactions.has(interaction.interactionId)) return 'duplicate';
    this.#interactions.set(interaction.interactionId, clone(interaction));
    return 'created';
  }

  async findById(interactionId: string): Promise<StoredDemoInteraction | null> {
    const interaction = this.#interactions.get(interactionId);
    return interaction ? clone(interaction) : null;
  }

  async list(): Promise<StoredDemoInteraction[]> {
    return [...this.#interactions.values()]
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map(clone);
  }

  async saveResult(
    interactionId: string,
    result: ConversationResult,
    completedAt: string,
  ): Promise<SaveResultOutcome> {
    if (interactionId !== result.interactionId) return 'id_mismatch';
    const current = this.#interactions.get(interactionId);
    if (!current) return 'not_found';
    if (current.result) return 'already_completed';

    this.#interactions.set(interactionId, {
      ...current,
      result: structuredClone(result),
      completedAt,
    });
    return 'saved';
  }

  async saveProfile(profile: StoredDemoProfile): Promise<void> {
    this.#profile = structuredClone(profile);
  }

  async findProfile(): Promise<StoredDemoProfile | null> {
    return this.#profile ? structuredClone(this.#profile) : null;
  }

  async reserveOutbound(
    interactionId: string,
    idempotencyKey: string,
  ): Promise<ReserveOutboundOutcome> {
    if (!this.#interactions.has(interactionId)) return 'not_found';
    const key = `${interactionId}:${idempotencyKey}`;
    if (this.#reservations.has(key)) return 'duplicate';
    this.#reservations.add(key);
    return 'reserved';
  }

  async recordMessageEvent(
    event: StoredDemoMessageEvent,
  ): Promise<RecordMessageEventOutcome> {
    if (!this.#interactions.has(event.interactionId)) return 'not_found';
    const key = eventKey(event);
    if (this.#eventKeys.has(key)) return 'duplicate';
    this.#eventKeys.add(key);
    const events = this.#events.get(event.interactionId) ?? [];
    events.push(structuredClone(event));
    this.#events.set(event.interactionId, events);
    return 'recorded';
  }

  async listMessageEvents(
    interactionId: string,
  ): Promise<StoredDemoMessageEvent[]> {
    return (this.#events.get(interactionId) ?? []).map((event) =>
      structuredClone(event),
    );
  }
}

function clone(interaction: StoredDemoInteraction): StoredDemoInteraction {
  return structuredClone(interaction);
}

function eventKey(event: StoredDemoMessageEvent): string {
  if (event.providerEventId) {
    return `${event.provider}:event:${event.providerEventId}`;
  }
  if (event.providerMessageId) {
    return `${event.provider}:message:${event.providerMessageId}`;
  }
  return `${event.interactionId}:${event.direction}:${event.eventType}:${event.idempotencyKey}`;
}
