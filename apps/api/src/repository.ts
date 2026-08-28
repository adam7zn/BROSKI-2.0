import type { ConversationResult, StoredDemoInteraction } from './domain.js';

export type CreateOutcome = 'created' | 'duplicate';
export type SaveResultOutcome = 'saved' | 'not_found' | 'already_completed';

export interface DemoInteractionRepository {
  create(interaction: StoredDemoInteraction): Promise<CreateOutcome>;
  findById(interactionId: string): Promise<StoredDemoInteraction | null>;
  list(): Promise<StoredDemoInteraction[]>;
  saveResult(
    interactionId: string,
    result: ConversationResult,
    completedAt: string,
  ): Promise<SaveResultOutcome>;
}

export class InMemoryDemoInteractionRepository implements DemoInteractionRepository {
  readonly #interactions = new Map<string, StoredDemoInteraction>();

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
}

function clone(interaction: StoredDemoInteraction): StoredDemoInteraction {
  return structuredClone(interaction);
}
