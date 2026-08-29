import {
  DuplicateInteractionError,
  InteractionAlreadyCompletedError,
  InteractionIdMismatchError,
  InteractionNotFoundError,
  type InteractionRepository,
  type StoredDemoMessageEventRecord,
  type StoredInteraction,
} from '@math-study-companion/database';

import type {
  ConversationResult,
  StoredDemoInteraction,
  StoredDemoMessageEvent,
  StoredDemoProfile,
} from './domain.js';
import type {
  CreateOutcome,
  DemoInteractionRepository,
  RecordMessageEventOutcome,
  ReserveOutboundOutcome,
  SaveResultOutcome,
} from './repository.js';

export class PostgresDemoInteractionRepositoryAdapter implements DemoInteractionRepository {
  constructor(private readonly database: InteractionRepository) {}

  async create(interaction: StoredDemoInteraction): Promise<CreateOutcome> {
    try {
      await this.database.start(interaction.context, {
        traceId: interaction.traceId,
      });
      return 'created';
    } catch (error) {
      if (error instanceof DuplicateInteractionError) return 'duplicate';
      throw error;
    }
  }

  async findById(interactionId: string): Promise<StoredDemoInteraction | null> {
    try {
      return toDemoInteraction(
        await this.database.getByInteractionId(interactionId),
      );
    } catch (error) {
      if (error instanceof InteractionNotFoundError) return null;
      throw error;
    }
  }

  async list(): Promise<StoredDemoInteraction[]> {
    return (await this.database.listRecent()).map(toDemoInteraction);
  }

  async saveResult(
    interactionId: string,
    result: ConversationResult,
    completedAt: string,
  ): Promise<SaveResultOutcome> {
    try {
      await this.database.complete(interactionId, result, {
        completedAt: new Date(completedAt),
      });
      return 'saved';
    } catch (error) {
      if (error instanceof InteractionNotFoundError) return 'not_found';
      if (error instanceof InteractionAlreadyCompletedError) {
        return 'already_completed';
      }
      if (error instanceof InteractionIdMismatchError) return 'id_mismatch';
      throw error;
    }
  }

  async saveProfile(profile: StoredDemoProfile): Promise<void> {
    await this.database.saveDemoProfile({
      ...profile,
      completedAt: new Date(profile.completedAt),
    });
  }

  async findProfile(): Promise<StoredDemoProfile | null> {
    const profile = await this.database.getDemoProfile();
    return profile
      ? {
          ...profile,
          completedAt: profile.completedAt.toISOString(),
        }
      : null;
  }

  async reserveOutbound(
    interactionId: string,
    idempotencyKey: string,
    traceId: string,
    reservedAt: string,
  ): Promise<ReserveOutboundOutcome> {
    return this.database.reserveDemoOutbound({
      interactionId,
      idempotencyKey,
      traceId,
      reservedAt: new Date(reservedAt),
    });
  }

  async recordMessageEvent(
    event: StoredDemoMessageEvent,
  ): Promise<RecordMessageEventOutcome> {
    return this.database.recordDemoMessageEvent({
      ...event,
      recordedAt: new Date(event.recordedAt),
    });
  }

  async listMessageEvents(
    interactionId: string,
  ): Promise<StoredDemoMessageEvent[]> {
    return (await this.database.listDemoMessageEvents(interactionId)).map(
      toDemoMessageEvent,
    );
  }
}

function toDemoInteraction(
  interaction: StoredInteraction,
): StoredDemoInteraction {
  return {
    interactionId: interaction.interactionId,
    traceId: interaction.traceId,
    context: {
      interactionId: interaction.interactionId,
      topic: interaction.topic,
      sourceText: interaction.sourceText,
      difficulty: interaction.difficulty,
      image: interaction.image,
      mode: interaction.mode,
      reason: interaction.reason,
    },
    result: toConversationResult(interaction),
    startedAt: interaction.createdAt.toISOString(),
    completedAt: interaction.completedAt?.toISOString() ?? null,
  };
}

function toDemoMessageEvent(
  event: StoredDemoMessageEventRecord,
): StoredDemoMessageEvent {
  return {
    ...event,
    recordedAt: event.recordedAt.toISOString(),
  };
}

function toConversationResult(
  interaction: StoredInteraction,
): ConversationResult | null {
  const fields = [
    interaction.question,
    interaction.studentReply,
    interaction.feedback,
    interaction.result,
  ];
  if (fields.every((field) => field === null)) return null;
  if (
    fields.some((field) => field === null) ||
    interaction.completedAt === null
  ) {
    throw new Error('Stored interaction has inconsistent completion fields');
  }

  return {
    interactionId: interaction.interactionId,
    question: interaction.question!,
    studentReply: interaction.studentReply!,
    feedback: interaction.feedback!,
    result: interaction.result!,
  };
}
