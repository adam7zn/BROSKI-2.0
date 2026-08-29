import type {
  BackendToConversation,
  ConversationToBackend,
  DemoMessageEventInput,
  DemoProfileInput,
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

export interface CompleteInteractionOptions {
  completedAt: Date;
}

export interface StoredInteraction {
  interactionId: string;
  topic: string;
  sourceText: string;
  difficulty: string;
  image: string | null;
  mode: BackendToConversation['mode'];
  reason: string;
  question: string | null;
  studentReply: string | null;
  feedback: string | null;
  result: string | null;
  traceId: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface StoredDemoProfileRecord extends DemoProfileInput {
  profileId: 'demo-student';
  traceId: string;
  completedAt: Date;
}

export interface StoredDemoMessageEventRecord extends DemoMessageEventInput {
  id: string;
  interactionId: string;
  traceId: string;
  recordedAt: Date;
}

export type ReserveOutboundRecordOutcome =
  'reserved' | 'duplicate' | 'not_found';
export type RecordDemoMessageEventOutcome =
  'recorded' | 'duplicate' | 'not_found';

export interface InteractionRepository {
  start(
    context: BackendToConversation,
    options: StartInteractionOptions,
  ): Promise<StoredInteraction>;
  complete(
    interactionId: string,
    result: ConversationToBackend,
    options: CompleteInteractionOptions,
  ): Promise<StoredInteraction>;
  getByInteractionId(interactionId: string): Promise<StoredInteraction>;
  listRecent(limit?: number): Promise<StoredInteraction[]>;
  saveDemoProfile(profile: StoredDemoProfileRecord): Promise<void>;
  getDemoProfile(): Promise<StoredDemoProfileRecord | null>;
  reserveDemoOutbound(input: {
    interactionId: string;
    idempotencyKey: string;
    traceId: string;
    reservedAt: Date;
  }): Promise<ReserveOutboundRecordOutcome>;
  recordDemoMessageEvent(
    event: StoredDemoMessageEventRecord,
  ): Promise<RecordDemoMessageEventOutcome>;
  listDemoMessageEvents(
    interactionId: string,
  ): Promise<StoredDemoMessageEventRecord[]>;
}

interface InteractionRow extends QueryResultRow {
  interaction_id: string;
  topic: string;
  source_text: string;
  difficulty: string;
  image: string | null;
  mode: BackendToConversation['mode'];
  reason: string;
  question: string | null;
  student_reply: string | null;
  feedback: string | null;
  result: string | null;
  trace_id: string;
  created_at: Date;
  completed_at: Date | null;
}

interface DemoProfileRow extends QueryResultRow {
  profile_id: 'demo-student';
  course: string;
  self_assessed_level: DemoProfileInput['selfAssessedLevel'];
  previous_grade: string | null;
  trace_id: string;
  completed_at: Date;
}

interface DemoMessageEventRow extends QueryResultRow {
  id: string;
  interaction_id: string;
  trace_id: string;
  provider: string;
  direction: DemoMessageEventInput['direction'];
  event_type: DemoMessageEventInput['eventType'];
  provider_event_id: string | null;
  provider_message_id: string | null;
  idempotency_key: string | null;
  occurred_at: Date;
  recorded_at: Date;
}

const columns = `
  interaction_id,
  topic,
  source_text,
  difficulty,
  image,
  mode,
  reason,
  question,
  student_reply,
  feedback,
  result,
  trace_id,
  created_at,
  completed_at
`;

const toStoredInteraction = (row: InteractionRow): StoredInteraction => ({
  interactionId: row.interaction_id,
  topic: row.topic,
  sourceText: row.source_text,
  difficulty: row.difficulty,
  image: row.image,
  mode: row.mode,
  reason: row.reason,
  question: row.question,
  studentReply: row.student_reply,
  feedback: row.feedback,
  result: row.result,
  traceId: row.trace_id,
  createdAt: row.created_at,
  completedAt: row.completed_at,
});

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '23505';

const isForeignKeyViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '23503';

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
          mode,
          reason,
          trace_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING ${columns}`,
        [
          context.interactionId,
          context.topic,
          context.sourceText,
          context.difficulty,
          context.image,
          context.mode,
          context.reason,
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
    options: CompleteInteractionOptions,
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
             result = $5,
             completed_at = $6
         WHERE interaction_id = $1
         RETURNING ${columns}`,
        [
          interactionId,
          result.question,
          result.studentReply,
          result.feedback,
          result.result,
          options.completedAt,
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

  async saveDemoProfile(profile: StoredDemoProfileRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO demo_profiles (
         profile_id, course, self_assessed_level, previous_grade, trace_id, completed_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (profile_id) DO UPDATE
       SET course = EXCLUDED.course,
           self_assessed_level = EXCLUDED.self_assessed_level,
           previous_grade = EXCLUDED.previous_grade,
           trace_id = EXCLUDED.trace_id,
           completed_at = EXCLUDED.completed_at`,
      [
        profile.profileId,
        profile.course,
        profile.selfAssessedLevel,
        profile.previousGrade,
        profile.traceId,
        profile.completedAt,
      ],
    );
  }

  async getDemoProfile(): Promise<StoredDemoProfileRecord | null> {
    const found = await this.pool.query<DemoProfileRow>(
      `SELECT profile_id, course, self_assessed_level, previous_grade, trace_id, completed_at
       FROM demo_profiles
       WHERE profile_id = 'demo-student'`,
    );
    const row = found.rows[0];
    return row
      ? {
          profileId: row.profile_id,
          course: row.course,
          selfAssessedLevel: row.self_assessed_level,
          previousGrade: row.previous_grade,
          traceId: row.trace_id,
          completedAt: row.completed_at,
        }
      : null;
  }

  async reserveDemoOutbound(input: {
    interactionId: string;
    idempotencyKey: string;
    traceId: string;
    reservedAt: Date;
  }): Promise<ReserveOutboundRecordOutcome> {
    const inserted = await this.pool.query(
      `INSERT INTO demo_outbound_reservations (
         interaction_id, idempotency_key, trace_id, reserved_at
       )
       SELECT $1, $2, $3, $4
       WHERE EXISTS (
         SELECT 1 FROM interactions WHERE interaction_id = $1
       )
       ON CONFLICT (interaction_id, idempotency_key) DO NOTHING
       RETURNING interaction_id`,
      [
        input.interactionId,
        input.idempotencyKey,
        input.traceId,
        input.reservedAt,
      ],
    );
    if (inserted.rowCount === 1) return 'reserved';
    const interaction = await this.pool.query(
      'SELECT 1 FROM interactions WHERE interaction_id = $1',
      [input.interactionId],
    );
    return interaction.rowCount === 0 ? 'not_found' : 'duplicate';
  }

  async recordDemoMessageEvent(
    event: StoredDemoMessageEventRecord,
  ): Promise<RecordDemoMessageEventOutcome> {
    try {
      await this.pool.query(
        `INSERT INTO demo_message_events (
           id, interaction_id, trace_id, provider, direction, event_type,
           provider_event_id, provider_message_id, idempotency_key,
           occurred_at, recorded_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          event.id,
          event.interactionId,
          event.traceId,
          event.provider,
          event.direction,
          event.eventType,
          event.providerEventId,
          event.providerMessageId,
          event.idempotencyKey,
          new Date(event.occurredAt),
          event.recordedAt,
        ],
      );
      return 'recorded';
    } catch (error) {
      if (isUniqueViolation(error)) return 'duplicate';
      if (isForeignKeyViolation(error)) return 'not_found';
      throw error;
    }
  }

  async listDemoMessageEvents(
    interactionId: string,
  ): Promise<StoredDemoMessageEventRecord[]> {
    const found = await this.pool.query<DemoMessageEventRow>(
      `SELECT id, interaction_id, trace_id, provider, direction, event_type,
              provider_event_id, provider_message_id, idempotency_key,
              occurred_at, recorded_at
       FROM demo_message_events
       WHERE interaction_id = $1
       ORDER BY occurred_at, recorded_at, id`,
      [interactionId],
    );
    return found.rows.map((row) => ({
      id: row.id,
      interactionId: row.interaction_id,
      traceId: row.trace_id,
      provider: row.provider,
      direction: row.direction,
      eventType: row.event_type,
      providerEventId: row.provider_event_id,
      providerMessageId: row.provider_message_id,
      idempotencyKey: row.idempotency_key,
      occurredAt: row.occurred_at.toISOString(),
      recordedAt: row.recorded_at,
    }));
  }
}
