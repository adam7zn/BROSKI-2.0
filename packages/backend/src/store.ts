import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BackendContext,
  InteractionOutcome,
  SendResult,
} from '@msc/conversation';

const here = dirname(fileURLToPath(import.meta.url));

export interface StoredInteraction {
  id: string;
  createdAt: string;
  conversationId: string;
  studyItemId: string | null;
  topic: string;
  difficulty: string;
  question: string | null;
  status: 'planned' | 'sent' | 'answered' | 'no_reply';
  result: string | null;
  studentReply: string | null;
  feedback: string | null;
  confidence: number | null;
}

/**
 * The interaction record.
 *
 * Raw replies land in `attempts` before anything is derived from them
 * (ADR-005), and every send is written to a durable ledger so a restart cannot
 * repeat a question.
 */
export class InteractionStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  }

  /** Records a planned interaction before anything is sent. */
  planInteraction(
    context: BackendContext,
    conversationId: string,
    studyItemId: string | null,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO interactions
           (id, created_at, conversation_id, study_item_id, topic, source_text,
            difficulty, image, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned')
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        context.interactionId,
        new Date().toISOString(),
        conversationId,
        studyItemId,
        context.topic,
        context.sourceText,
        context.difficulty,
        context.image,
      );
  }

  wasSent(idempotencyKey: string): boolean {
    const row = this.#db
      .prepare('SELECT 1 AS hit FROM sent_messages WHERE idempotency_key = ?')
      .get(idempotencyKey);
    return row !== undefined;
  }

  recordSent(
    idempotencyKey: string,
    interactionId: string,
    provider: string,
    sent: SendResult,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO sent_messages
           (idempotency_key, interaction_id, provider, provider_message_id, sent_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        idempotencyKey,
        interactionId,
        provider,
        sent.providerMessageId,
        sent.acceptedAt,
      );
  }

  /** Writes everything one finished (or unanswered) interaction produced. */
  saveOutcome(outcome: InteractionOutcome): void {
    const { context, question, trace } = outcome;

    this.#db
      .prepare(
        `UPDATE interactions
            SET question = ?, expected_answer = ?, rubric = ?, status = ?, trace = ?
          WHERE id = ?`,
      )
      .run(
        question.question,
        question.expectedAnswer,
        question.rubric,
        outcome.status === 'completed' ? 'answered' : 'no_reply',
        JSON.stringify(trace),
        context.interactionId,
      );

    this.recordSent(
      `${context.interactionId}:question`,
      context.interactionId,
      trace.provider,
      { providerMessageId: trace.questionMessageId, acceptedAt: trace.questionSentAt, deduplicated: false },
    );

    if (outcome.status !== 'completed') return;

    this.#db
      .prepare(
        `INSERT INTO attempts
           (interaction_id, student_reply, result, feedback, confidence,
            deterministic, agent, model, prompt_version, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        context.interactionId,
        outcome.reply.text,
        outcome.evaluation.result,
        outcome.evaluation.feedback,
        outcome.evaluation.confidence,
        outcome.evaluation.deterministic ? 1 : 0,
        outcome.evaluation.meta.agent,
        outcome.evaluation.meta.model,
        outcome.evaluation.meta.promptVersion,
        new Date().toISOString(),
      );

    if (trace.feedbackMessageId) {
      this.recordSent(
        `${context.interactionId}:feedback`,
        context.interactionId,
        trace.provider,
        {
          providerMessageId: trace.feedbackMessageId,
          acceptedAt: new Date().toISOString(),
          deduplicated: false,
        },
      );
    }
  }

  /** When each study item was last used, for the selection rule. */
  lastUsedByStudyItem(): Map<string, string> {
    const rows = this.#db
      .prepare(
        `SELECT study_item_id AS id, MAX(created_at) AS last_used
           FROM interactions
          WHERE study_item_id IS NOT NULL
          GROUP BY study_item_id`,
      )
      .all() as Array<{ id: string; last_used: string }>;
    return new Map(rows.map((row) => [row.id, row.last_used]));
  }

  recentInteractions(limit = 20): StoredInteraction[] {
    const rows = this.#db
      .prepare(
        `SELECT i.id, i.created_at, i.conversation_id, i.study_item_id, i.topic,
                i.difficulty, i.question, i.status,
                a.result, a.student_reply, a.feedback, a.confidence
           FROM interactions i
           LEFT JOIN attempts a ON a.interaction_id = i.id
          ORDER BY i.created_at DESC
          LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row['id']),
      createdAt: String(row['created_at']),
      conversationId: String(row['conversation_id']),
      studyItemId: row['study_item_id'] === null ? null : String(row['study_item_id']),
      topic: String(row['topic']),
      difficulty: String(row['difficulty']),
      question: row['question'] === null ? null : String(row['question']),
      status: String(row['status']) as StoredInteraction['status'],
      result: row['result'] === null ? null : String(row['result']),
      studentReply: row['student_reply'] === null ? null : String(row['student_reply']),
      feedback: row['feedback'] === null ? null : String(row['feedback']),
      confidence: row['confidence'] === null ? null : Number(row['confidence']),
    }));
  }

  close(): void {
    this.#db.close();
  }
}
