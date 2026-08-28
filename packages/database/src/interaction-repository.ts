import type {
  BackendToConversation,
  ConversationToBackend,
} from '@math-study-companion/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  DuplicateInteractionError,
  InteractionAlreadyCompletedError,
  InteractionIdMismatchError,
  InteractionNotFoundError,
} from './repository-errors.js';

export interface StartInteractionOptions {
  traceId: string;
}

export interface StoredInteraction {
  interactionId: string;
  topic: string;
  sourceText: string;
  difficulty: string;
  image: string | null;
  question: string | null;
  studentReply: string | null;
  feedback: string | null;
  result: string | null;
  traceId: string;
  createdAt: Date;
}

export interface InteractionRepository {
  start(
    context: BackendToConversation,
    options: StartInteractionOptions,
  ): Promise<StoredInteraction>;
  complete(
    interactionId: string,
    result: ConversationToBackend,
  ): Promise<StoredInteraction>;
  getByInteractionId(interactionId: string): Promise<StoredInteraction>;
  listRecent(limit?: number): Promise<StoredInteraction[]>;
}

interface InteractionRow extends QueryResultRow {
  interaction_id: string;
  topic: string;
  source_text: string;
  difficulty: string;
  image: string | null;
  question: string | null;
  student_reply: string | null;
  feedback: string | null;
  result: string | null;
  trace_id: string;
  created_at: Date;
}

const columns = `
  interaction_id,
  topic,
  source_text,
  difficulty,
  image,
  question,
  student_reply,
  feedback,
  result,
  trace_id,
  created_at
`;

const toStoredInteraction = (row: InteractionRow): StoredInteraction => ({
  interactionId: row.interaction_id,
  topic: row.topic,
  sourceText: row.source_text,
  difficulty: row.difficulty,
  image: row.image,
  question: row.question,
  studentReply: row.student_reply,
  feedback: row.feedback,
  result: row.result,
  traceId: row.trace_id,
  createdAt: row.created_at,
});

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '23505';

const rollback = async (client: PoolClient): Promise<void> => {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the operation error; the pool discards broken clients as needed.
  }
};

export class PostgresInteractionRepository implements InteractionRepository {
  constructor(private readonly pool: Pool) {}

  async start(
    context: BackendToConversation,
    options: StartInteractionOptions,
  ): Promise<StoredInteraction> {
    try {
      const inserted = await this.pool.query<InteractionRow>(
        `INSERT INTO interactions (
          interaction_id,
          topic,
          source_text,
          difficulty,
          image,
          trace_id
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING ${columns}`,
        [
          context.interactionId,
          context.topic,
          context.sourceText,
          context.difficulty,
          context.image,
          options.traceId,
        ],
      );

      return toStoredInteraction(inserted.rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateInteractionError(context.interactionId, {
          cause: error,
        });
      }

      throw error;
    }
  }

  async complete(
    interactionId: string,
    result: ConversationToBackend,
  ): Promise<StoredInteraction> {
    if (interactionId !== result.interactionId) {
      throw new InteractionIdMismatchError(interactionId, result.interactionId);
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const existing = await client.query<{
        interaction_id: string;
        question: string | null;
      }>(
        `SELECT interaction_id, question
         FROM interactions
         WHERE interaction_id = $1
         FOR UPDATE`,
        [interactionId],
      );

      if (existing.rowCount === 0) {
        throw new InteractionNotFoundError(interactionId);
      }
      if (existing.rows[0]!.question !== null) {
        throw new InteractionAlreadyCompletedError(interactionId);
      }

      const updated = await client.query<InteractionRow>(
        `UPDATE interactions
         SET question = $2,
             student_reply = $3,
             feedback = $4,
             result = $5
         WHERE interaction_id = $1
         RETURNING ${columns}`,
        [
          interactionId,
          result.question,
          result.studentReply,
          result.feedback,
          result.result,
        ],
      );

      await client.query('COMMIT');
      return toStoredInteraction(updated.rows[0]!);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getByInteractionId(interactionId: string): Promise<StoredInteraction> {
    const found = await this.pool.query<InteractionRow>(
      `SELECT ${columns}
       FROM interactions
       WHERE interaction_id = $1`,
      [interactionId],
    );

    const row = found.rows[0];
    if (row === undefined) {
      throw new InteractionNotFoundError(interactionId);
    }

    return toStoredInteraction(row);
  }

  async listRecent(limit = 20): Promise<StoredInteraction[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('Recent interaction limit must be from 1 to 100.');
    }

    const found = await this.pool.query<InteractionRow>(
      `SELECT ${columns}
       FROM interactions
       ORDER BY created_at DESC, interaction_id DESC
       LIMIT $1`,
      [limit],
    );

    return found.rows.map(toStoredInteraction);
  }
}
