import { randomUUID } from 'node:crypto';

import type {
  ConversationAgentOutput,
  DemoMessageEventInput,
} from '@math-study-companion/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export interface HostedMessagingSessionRecord {
  interactionId: string;
  provider: string;
  participantAddress: string;
  providerLine: string;
  status: 'active' | 'completed' | 'stopped' | 'failed';
  turnNumber: number;
  agentState: unknown;
  lastPromptAt: string | null;
  traceId: string;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostedInboundMessageRecord {
  provider: string;
  providerEventId: string;
  providerMessageId: string;
  interactionId: string;
  turnNumber: number;
  senderAddress: string;
  content: string;
  receivedAt: string;
  processingStatus: 'pending' | 'processing' | 'processed' | 'failed';
  attemptCount: number;
  errorCode: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface HostedOutboundRecord {
  interactionId: string;
  idempotencyKey: string;
  turnNumber: number;
  purpose: string;
  content: string | null;
  mediaUrl: string | null;
  deliveryStatus:
    | 'pending'
    | 'processing'
    | 'accepted'
    | 'sent'
    | 'delivered'
    | 'failed'
    | 'uncertain'
    | 'suppressed';
  attemptCount: number;
  providerMessageId: string | null;
  acceptedAt: string | null;
  failureCode: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewHostedOutboundRecord {
  interactionId: string;
  idempotencyKey: string;
  turnNumber: number;
  purpose: string;
  content: string | null;
  mediaUrl: string | null;
  traceId: string;
  createdAt: string;
}

interface SessionRow extends QueryResultRow {
  interaction_id: string;
  provider: string;
  participant_address: string;
  provider_line: string;
  status: HostedMessagingSessionRecord['status'];
  turn_number: number;
  agent_state: unknown;
  last_prompt_at: Date | null;
  trace_id: string;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
}

interface InboundRow extends QueryResultRow {
  provider: string;
  provider_event_id: string;
  provider_message_id: string;
  interaction_id: string;
  turn_number: number;
  sender_address: string;
  content: string;
  received_at: Date;
  processing_status: HostedInboundMessageRecord['processingStatus'];
  attempt_count: number;
  error_code: string | null;
  trace_id: string;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
}

interface OutboundRow extends QueryResultRow {
  interaction_id: string;
  idempotency_key: string;
  turn_number: number;
  purpose: string;
  content: string | null;
  media_url: string | null;
  delivery_status: HostedOutboundRecord['deliveryStatus'];
  attempt_count: number;
  provider_message_id: string | null;
  accepted_at: Date | null;
  failure_code: string | null;
  trace_id: string;
  created_at: Date;
  updated_at: Date;
}

const sessionColumns = `interaction_id, provider, participant_address,
  provider_line, status, turn_number, agent_state, last_prompt_at, trace_id,
  failure_code, created_at, updated_at`;
const inboundColumns = `provider, provider_event_id, provider_message_id,
  interaction_id, turn_number, sender_address, content, received_at, processing_status,
  attempt_count, error_code, trace_id, created_at, updated_at, processed_at`;
const outboundColumns = `interaction_id, idempotency_key, turn_number, purpose,
  content, media_url, delivery_status, attempt_count, provider_message_id,
  accepted_at, failure_code, trace_id, created_at, updated_at`;

export class PostgresHostedMessagingRepository {
  constructor(private readonly pool: Pool) {}

  async createSession(
    session: HostedMessagingSessionRecord,
    outbounds: NewHostedOutboundRecord[],
  ): Promise<'created' | 'duplicate' | 'not_found'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO demo_messaging_sessions (
           interaction_id, provider, participant_address, provider_line,
           status, turn_number, agent_state, last_prompt_at, trace_id,
           failure_code, created_at, updated_at
         )
         SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12
         WHERE EXISTS (SELECT 1 FROM interactions WHERE interaction_id = $1)
         ON CONFLICT (interaction_id) DO NOTHING
         RETURNING interaction_id`,
        [
          session.interactionId,
          session.provider,
          session.participantAddress,
          session.providerLine,
          session.status,
          session.turnNumber,
          JSON.stringify(session.agentState),
          session.lastPromptAt,
          session.traceId,
          session.failureCode,
          session.createdAt,
          session.updatedAt,
        ],
      );
      if (inserted.rowCount === 0) {
        const exists = await client.query(
          'SELECT 1 FROM interactions WHERE interaction_id = $1',
          [session.interactionId],
        );
        await client.query('ROLLBACK');
        return exists.rowCount === 0 ? 'not_found' : 'duplicate';
      }
      await insertOutbounds(client, outbounds);
      await client.query('COMMIT');
      return 'created';
    } catch (error) {
      await rollback(client);
      if (postgresCode(error) === '23505') return 'duplicate';
      throw error;
    } finally {
      client.release();
    }
  }

  async findSession(
    interactionId: string,
  ): Promise<HostedMessagingSessionRecord | null> {
    const found = await this.pool.query<SessionRow>(
      `SELECT ${sessionColumns} FROM demo_messaging_sessions
       WHERE interaction_id = $1`,
      [interactionId],
    );
    return found.rows[0] ? toSession(found.rows[0]) : null;
  }

  async findRoutableSession(
    provider: string,
    participantAddress: string,
    providerLine: string,
  ): Promise<HostedMessagingSessionRecord | null> {
    const found = await this.pool.query<SessionRow>(
      `SELECT ${sessionColumns} FROM demo_messaging_sessions
       WHERE provider = $1 AND participant_address = $2
         AND provider_line = $3 AND status IN ('active', 'completed')
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [provider, participantAddress, providerLine],
    );
    return found.rows[0] ? toSession(found.rows[0]) : null;
  }

  async findOutboundByProviderMessageId(
    providerMessageId: string,
  ): Promise<HostedOutboundRecord | null> {
    const found = await this.pool.query<OutboundRow>(
      `SELECT ${outboundColumns} FROM demo_outbound_outbox
       WHERE provider_message_id = $1`,
      [providerMessageId],
    );
    return found.rows[0] ? toOutbound(found.rows[0]) : null;
  }

  async enqueueInbound(input: {
    message: HostedInboundMessageRecord;
    event: DemoMessageEventInput;
  }): Promise<'queued' | 'duplicate' | 'not_found'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO demo_inbound_messages (
           provider, provider_event_id, provider_message_id, interaction_id,
           turn_number, sender_address, content, received_at, processing_status,
           attempt_count, error_code, trace_id, created_at, updated_at, processed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (provider, provider_event_id) DO NOTHING
         RETURNING provider_event_id`,
        [
          input.message.provider,
          input.message.providerEventId,
          input.message.providerMessageId,
          input.message.interactionId,
          input.message.turnNumber,
          input.message.senderAddress,
          input.message.content,
          input.message.receivedAt,
          input.message.processingStatus,
          input.message.attemptCount,
          input.message.errorCode,
          input.message.traceId,
          input.message.createdAt,
          input.message.updatedAt,
          input.message.processedAt,
        ],
      );
      if (inserted.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'duplicate';
      }
      await insertEvent(
        client,
        input.message.interactionId,
        input.message.traceId,
        input.event,
        input.message.createdAt,
      );
      await client.query('COMMIT');
      return 'queued';
    } catch (error) {
      await rollback(client);
      if (postgresCode(error) === '23503') return 'not_found';
      throw error;
    } finally {
      client.release();
    }
  }

  async claimInbound(input: {
    now: string;
    staleBefore: string;
  }): Promise<HostedInboundMessageRecord | null> {
    const claimed = await this.pool.query<InboundRow>(
      `WITH candidate AS (
         SELECT provider, provider_event_id
         FROM demo_inbound_messages
         WHERE processing_status = 'pending'
            OR (processing_status = 'processing' AND updated_at < $2)
         ORDER BY received_at, provider_event_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE demo_inbound_messages message
       SET processing_status = 'processing',
           attempt_count = message.attempt_count + 1,
           updated_at = $1
       FROM candidate
       WHERE message.provider = candidate.provider
         AND message.provider_event_id = candidate.provider_event_id
       RETURNING message.*`,
      [input.now, input.staleBefore],
    );
    return claimed.rows[0] ? toInbound(claimed.rows[0]) : null;
  }

  async history(interactionId: string): Promise<
    Array<{
      direction: 'inbound' | 'outbound';
      text: string;
      occurredAt: string;
    }>
  > {
    const history = await this.pool.query<{
      direction: 'inbound' | 'outbound';
      text: string;
      occurred_at: Date;
    }>(
      `SELECT 'inbound'::text AS direction, content AS text, received_at AS occurred_at
       FROM demo_inbound_messages
       WHERE interaction_id = $1 AND processing_status = 'processed'
       UNION ALL
       SELECT 'outbound'::text AS direction, content AS text,
              COALESCE(accepted_at, created_at) AS occurred_at
       FROM demo_outbound_outbox
       WHERE interaction_id = $1 AND content IS NOT NULL
         AND delivery_status IN ('accepted', 'sent', 'delivered')
       ORDER BY occurred_at`,
      [interactionId],
    );
    return history.rows.map((row) => ({
      direction: row.direction,
      text: row.text,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async completeInbound(input: {
    message: HostedInboundMessageRecord;
    output: ConversationAgentOutput;
    outbounds: NewHostedOutboundRecord[];
    now: string;
  }): Promise<'completed' | 'lost_claim' | 'stale'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT 1 FROM demo_inbound_messages
         WHERE provider = $1 AND provider_event_id = $2
           AND processing_status = 'processing' AND attempt_count = $3
         FOR UPDATE`,
        [
          input.message.provider,
          input.message.providerEventId,
          input.message.attemptCount,
        ],
      );
      if (locked.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'lost_claim';
      }
      const session = await client.query<{
        status: HostedMessagingSessionRecord['status'];
        turn_number: number;
      }>(
        `SELECT status, turn_number FROM demo_messaging_sessions
         WHERE interaction_id = $1 FOR UPDATE`,
        [input.message.interactionId],
      );
      const currentSession = session.rows[0];
      const isCompletedFollowUp =
        currentSession?.status === 'completed' &&
        input.output.status === 'waiting' &&
        input.output.result === null &&
        input.output.profile === null;
      if (
        !currentSession ||
        (currentSession.status !== 'active' && !isCompletedFollowUp) ||
        currentSession.turn_number !== input.message.turnNumber
      ) {
        await client.query(
          `UPDATE demo_inbound_messages
           SET processing_status = 'failed', error_code = 'STALE_INBOUND_TURN',
               updated_at = $4
           WHERE provider = $1 AND provider_event_id = $2 AND attempt_count = $3`,
          [
            input.message.provider,
            input.message.providerEventId,
            input.message.attemptCount,
            input.now,
          ],
        );
        await client.query('COMMIT');
        return 'stale';
      }
      if (input.output.profile) {
        await client.query(
          `INSERT INTO demo_profiles (
             profile_id, course, self_assessed_level, previous_grade, trace_id, completed_at
           ) VALUES ('demo-student', $1, $2, $3, $4, $5)
           ON CONFLICT (profile_id) DO UPDATE
           SET course = EXCLUDED.course,
               self_assessed_level = EXCLUDED.self_assessed_level,
               previous_grade = EXCLUDED.previous_grade,
               trace_id = EXCLUDED.trace_id,
               completed_at = EXCLUDED.completed_at`,
          [
            input.output.profile.course,
            input.output.profile.selfAssessedLevel,
            input.output.profile.previousGrade,
            input.message.traceId,
            input.now,
          ],
        );
      }
      if (input.output.result) {
        const savedResult = await client.query(
          `UPDATE interactions
           SET question = $2, student_reply = $3, feedback = $4,
               result = $5, completed_at = $6
           WHERE interaction_id = $1 AND question IS NULL
           RETURNING interaction_id`,
          [
            input.message.interactionId,
            input.output.result.question,
            input.output.result.studentReply,
            input.output.result.feedback,
            input.output.result.result,
            input.now,
          ],
        );
        if (savedResult.rowCount === 0) {
          await rollback(client);
          await this.failInbound({
            message: input.message,
            errorCode: 'INTERACTION_ALREADY_COMPLETED',
            now: input.now,
          });
          return 'stale';
        }
      }
      await insertOutbounds(client, input.outbounds);
      const status = isCompletedFollowUp
        ? 'completed'
        : input.output.status === 'waiting'
          ? 'active'
          : input.output.status === 'completed'
            ? 'completed'
            : 'stopped';
      await client.query(
        `UPDATE demo_messaging_sessions
         SET status = $2, turn_number = turn_number + 1,
             agent_state = $3::jsonb, updated_at = $4
         WHERE interaction_id = $1`,
        [
          input.message.interactionId,
          status,
          JSON.stringify(input.output.agentState),
          input.now,
        ],
      );
      await client.query(
        `UPDATE demo_inbound_messages
         SET processing_status = 'processed', processed_at = $4, updated_at = $4
         WHERE provider = $1 AND provider_event_id = $2 AND attempt_count = $3`,
        [
          input.message.provider,
          input.message.providerEventId,
          input.message.attemptCount,
          input.now,
        ],
      );
      await client.query('COMMIT');
      return 'completed';
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async discardInbound(input: {
    message: HostedInboundMessageRecord;
    errorCode: string;
    now: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE demo_inbound_messages
       SET processing_status = 'failed', error_code = $4, updated_at = $5
       WHERE provider = $1 AND provider_event_id = $2
         AND processing_status = 'processing' AND attempt_count = $3`,
      [
        input.message.provider,
        input.message.providerEventId,
        input.message.attemptCount,
        input.errorCode,
        input.now,
      ],
    );
  }

  async failInbound(input: {
    message: HostedInboundMessageRecord;
    errorCode: string;
    now: string;
  }): Promise<void> {
    await this.pool.query(
      `WITH failed AS (
         UPDATE demo_inbound_messages
         SET processing_status = 'failed', error_code = $4, updated_at = $5
         WHERE provider = $1 AND provider_event_id = $2 AND attempt_count = $3
         RETURNING interaction_id
       )
       UPDATE demo_messaging_sessions session
       SET status = 'failed', failure_code = $4, updated_at = $5
       FROM failed WHERE session.interaction_id = failed.interaction_id`,
      [
        input.message.provider,
        input.message.providerEventId,
        input.message.attemptCount,
        input.errorCode,
        input.now,
      ],
    );
  }

  async claimOutbound(input: {
    now: string;
    staleBefore: string;
  }): Promise<HostedOutboundRecord | null> {
    const claimed = await this.pool.query<OutboundRow>(
      `WITH candidate AS (
         SELECT interaction_id, idempotency_key
         FROM demo_outbound_outbox
         WHERE delivery_status = 'pending'
            OR (delivery_status = 'processing' AND updated_at < $2)
         ORDER BY created_at, interaction_id, idempotency_key
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE demo_outbound_outbox message
       SET delivery_status = 'processing',
           attempt_count = message.attempt_count + 1,
           updated_at = $1
       FROM candidate
       WHERE message.interaction_id = candidate.interaction_id
         AND message.idempotency_key = candidate.idempotency_key
       RETURNING message.*`,
      [input.now, input.staleBefore],
    );
    return claimed.rows[0] ? toOutbound(claimed.rows[0]) : null;
  }

  async markOutboundAccepted(input: {
    message: HostedOutboundRecord;
    providerMessageId: string;
    acceptedAt: string;
    event: DemoMessageEventInput;
    now: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE demo_outbound_outbox
         SET delivery_status = 'accepted', provider_message_id = $3,
             accepted_at = $4, updated_at = $5
         WHERE interaction_id = $1 AND idempotency_key = $2`,
        [
          input.message.interactionId,
          input.message.idempotencyKey,
          input.providerMessageId,
          input.acceptedAt,
          input.now,
        ],
      );
      await client.query(
        `UPDATE demo_messaging_sessions SET last_prompt_at = $2, updated_at = $3
         WHERE interaction_id = $1`,
        [input.message.interactionId, input.acceptedAt, input.now],
      );
      await insertEvent(
        client,
        input.message.interactionId,
        input.message.traceId,
        input.event,
        input.now,
      );
      await client.query('COMMIT');
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markOutboundTerminal(input: {
    message: HostedOutboundRecord;
    status: 'failed' | 'uncertain' | 'suppressed';
    errorCode: string;
    event?: DemoMessageEventInput;
    now: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE demo_outbound_outbox
         SET delivery_status = $3, failure_code = $4, updated_at = $5
         WHERE interaction_id = $1 AND idempotency_key = $2`,
        [
          input.message.interactionId,
          input.message.idempotencyKey,
          input.status,
          input.errorCode,
          input.now,
        ],
      );
      if (input.event) {
        await insertEvent(
          client,
          input.message.interactionId,
          input.message.traceId,
          input.event,
          input.now,
        );
      }
      if (input.status !== 'suppressed') {
        await client.query(
          `UPDATE demo_messaging_sessions
           SET status = 'failed', failure_code = $2, updated_at = $3
           WHERE interaction_id = $1`,
          [input.message.interactionId, input.errorCode, input.now],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDelivery(input: {
    providerMessageId: string;
    event: DemoMessageEventInput;
    failureCode?: string;
    now: string;
  }): Promise<'recorded' | 'duplicate' | 'not_found'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<OutboundRow>(
        `SELECT ${outboundColumns} FROM demo_outbound_outbox
         WHERE provider_message_id = $1 FOR UPDATE`,
        [input.providerMessageId],
      );
      const message = found.rows[0];
      if (!message) {
        await client.query('ROLLBACK');
        return 'not_found';
      }
      const inserted = await insertEvent(
        client,
        message.interaction_id,
        message.trace_id,
        input.event,
        input.now,
      );
      if (!inserted) {
        await client.query('ROLLBACK');
        return 'duplicate';
      }
      const status =
        input.event.eventType === 'sent'
          ? 'sent'
          : input.event.eventType === 'delivered'
            ? 'delivered'
            : 'failed';
      await client.query(
        `UPDATE demo_outbound_outbox
         SET delivery_status = CASE
               WHEN delivery_status IN ('failed', 'uncertain', 'suppressed')
                 THEN delivery_status
               WHEN $2 = 'failed' THEN 'failed'
               WHEN delivery_status = 'delivered' THEN 'delivered'
               ELSE $2
             END,
             failure_code = CASE
               WHEN $2 = 'failed' THEN $4
               ELSE failure_code
             END,
             updated_at = $3
         WHERE provider_message_id = $1`,
        [
          input.providerMessageId,
          status,
          input.now,
          input.failureCode ?? 'SENDBLUE_ERROR',
        ],
      );
      if (status === 'failed') {
        await client.query(
          `UPDATE demo_messaging_sessions
           SET status = 'failed', failure_code = $3, updated_at = $2
           WHERE interaction_id = $1`,
          [
            message.interaction_id,
            input.now,
            input.failureCode ?? 'SENDBLUE_ERROR',
          ],
        );
      }
      await client.query('COMMIT');
      return 'recorded';
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async stopSession(input: {
    interactionId: string;
    status: 'stopped' | 'failed';
    failureCode?: string;
    now: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE demo_messaging_sessions
       SET status = $2, failure_code = $3, updated_at = $4
       WHERE interaction_id = $1`,
      [
        input.interactionId,
        input.status,
        input.status === 'failed'
          ? (input.failureCode ?? 'MESSAGING_FAILED')
          : null,
        input.now,
      ],
    );
  }

  async listInbound(
    interactionId: string,
  ): Promise<HostedInboundMessageRecord[]> {
    const found = await this.pool.query<InboundRow>(
      `SELECT ${inboundColumns} FROM demo_inbound_messages
       WHERE interaction_id = $1 ORDER BY received_at, provider_event_id`,
      [interactionId],
    );
    return found.rows.map(toInbound);
  }

  async listOutbox(interactionId: string): Promise<HostedOutboundRecord[]> {
    const found = await this.pool.query<OutboundRow>(
      `SELECT ${outboundColumns} FROM demo_outbound_outbox
       WHERE interaction_id = $1 ORDER BY turn_number, created_at, idempotency_key`,
      [interactionId],
    );
    return found.rows.map(toOutbound);
  }
}

async function insertOutbounds(
  client: PoolClient,
  outbounds: NewHostedOutboundRecord[],
): Promise<void> {
  for (const outbound of outbounds) {
    await client.query(
      `INSERT INTO demo_outbound_outbox (
         interaction_id, idempotency_key, turn_number, purpose, content,
         media_url, trace_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (interaction_id, idempotency_key) DO NOTHING`,
      [
        outbound.interactionId,
        outbound.idempotencyKey,
        outbound.turnNumber,
        outbound.purpose,
        outbound.content,
        outbound.mediaUrl,
        outbound.traceId,
        outbound.createdAt,
      ],
    );
  }
}

async function insertEvent(
  client: PoolClient,
  interactionId: string,
  traceId: string,
  event: DemoMessageEventInput,
  recordedAt: string,
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO demo_message_events (
       id, interaction_id, trace_id, provider, direction, event_type,
       provider_event_id, provider_message_id, idempotency_key,
       occurred_at, recorded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      randomUUID(),
      interactionId,
      traceId,
      event.provider,
      event.direction,
      event.eventType,
      event.providerEventId,
      event.providerMessageId,
      event.idempotencyKey,
      event.occurredAt,
      recordedAt,
    ],
  );
  return inserted.rowCount === 1;
}

function toSession(row: SessionRow): HostedMessagingSessionRecord {
  return {
    interactionId: row.interaction_id,
    provider: row.provider,
    participantAddress: row.participant_address,
    providerLine: row.provider_line,
    status: row.status,
    turnNumber: row.turn_number,
    agentState: row.agent_state,
    lastPromptAt: row.last_prompt_at?.toISOString() ?? null,
    traceId: row.trace_id,
    failureCode: row.failure_code,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toInbound(row: InboundRow): HostedInboundMessageRecord {
  return {
    provider: row.provider,
    providerEventId: row.provider_event_id,
    providerMessageId: row.provider_message_id,
    interactionId: row.interaction_id,
    turnNumber: row.turn_number,
    senderAddress: row.sender_address,
    content: row.content,
    receivedAt: row.received_at.toISOString(),
    processingStatus: row.processing_status,
    attemptCount: row.attempt_count,
    errorCode: row.error_code,
    traceId: row.trace_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    processedAt: row.processed_at?.toISOString() ?? null,
  };
}

function toOutbound(row: OutboundRow): HostedOutboundRecord {
  return {
    interactionId: row.interaction_id,
    idempotencyKey: row.idempotency_key,
    turnNumber: row.turn_number,
    purpose: row.purpose,
    content: row.content,
    mediaUrl: row.media_url,
    deliveryStatus: row.delivery_status,
    attemptCount: row.attempt_count,
    providerMessageId: row.provider_message_id,
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    failureCode: row.failure_code,
    traceId: row.trace_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original operation failure.
  }
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}
