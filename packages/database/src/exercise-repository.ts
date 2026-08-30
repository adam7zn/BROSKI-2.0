import { createHash, randomUUID } from 'node:crypto';

import {
  exerciseDraftInputSchema,
  exerciseReviewInputSchema,
  verifiedExerciseContextSchema,
  verifiedExerciseSummarySchema,
  type ExerciseDraftInput,
  type ExerciseReviewInput,
  type ExerciseVerificationState,
  type VerifiedExerciseContext,
  type VerifiedExerciseSummary,
} from '@math-study-companion/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export interface StoredExercise extends ExerciseDraftInput {
  exerciseId: string;
  sourceDocumentId: string;
  printedPageNumber: string;
  verificationState: ExerciseVerificationState;
  contentChecksum: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseCatalogRepository {
  listVerified(): Promise<VerifiedExerciseSummary[]>;
  getVerified(exerciseId: string): Promise<VerifiedExerciseContext | null>;
  getVerifiedForInteraction(
    interactionId: string,
  ): Promise<VerifiedExerciseContext | null>;
}

interface ExerciseRow extends QueryResultRow {
  id: string;
  source_document_id: string;
  source_page_id: string;
  source_block_id: string | null;
  source_bounding_box: [number, number, number, number];
  printed_page_number: string;
  section_code: string;
  section_title: string;
  exercise_number: string;
  part_label: string;
  topic: string;
  prompt: string;
  answer_payload: ExerciseDraftInput['answerPayload'];
  solution_text: string;
  rubric: string;
  difficulty: ExerciseDraftInput['difficulty'];
  grading_strategy: ExerciseDraftInput['gradingStrategy'];
  verification_state: ExerciseVerificationState;
  content_checksum: string;
  verified_by: string | null;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const columns = `
  e.id,
  p.document_id AS source_document_id,
  e.source_page_id,
  e.source_block_id,
  e.source_bounding_box,
  p.printed_page_number,
  e.section_code,
  e.section_title,
  e.exercise_number,
  e.part_label,
  e.topic,
  e.prompt,
  e.answer_payload,
  e.solution_text,
  e.rubric,
  e.difficulty,
  e.grading_strategy,
  e.verification_state,
  e.content_checksum,
  e.verified_by,
  e.verified_at,
  e.created_at,
  e.updated_at
`;

export class PostgresExerciseRepository implements ExerciseCatalogRepository {
  constructor(private readonly pool: Pool) {}

  async createDraft(input: ExerciseDraftInput): Promise<StoredExercise> {
    const draft = exerciseDraftInputSchema.parse(input);
    const checksum = exerciseContentChecksum(draft);
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO exercises (
         id, source_page_id, source_block_id, source_bounding_box,
         section_code, section_title, exercise_number, part_label, topic,
         prompt, answer_payload, solution_text, rubric, difficulty,
         grading_strategy, verification_state, content_checksum
       )
       SELECT $1, p.id, $3, $4::jsonb, $5, $6, $7, $8, $9, $10,
              $11::jsonb, $12, $13, $14, $15, 'draft', $16
       FROM source_pages p
       WHERE p.id = $2 AND p.printed_page_number IS NOT NULL
         AND (
           $3::uuid IS NULL OR EXISTS (
             SELECT 1 FROM source_blocks b
             WHERE b.id = $3 AND b.source_page_id = p.id AND b.deleted_at IS NULL
           )
         )
       ON CONFLICT (source_page_id, exercise_number, part_label) DO NOTHING
       RETURNING id`,
      valuesForDraft(randomUUID(), draft, checksum),
    );
    const created = inserted.rows[0];
    if (created) {
      const stored = await this.get(created.id);
      if (!stored) {
        throw new Error(`Exercise ${created.id} disappeared after creation.`);
      }
      return stored;
    }

    const existing = await this.findBySourceIdentity(
      draft.sourcePageId,
      draft.exerciseNumber,
      draft.partLabel,
    );
    if (!existing) {
      throw new Error(
        'The source page or source block is missing, mismatched, or lacks a printed page number.',
      );
    }
    if (existing.contentChecksum !== checksum) {
      throw new Error(
        `Exercise ${draft.exerciseNumber}${draft.partLabel} already exists with different content.`,
      );
    }
    return existing;
  }

  async listPage(sourcePageId: string): Promise<StoredExercise[]> {
    const found = await this.pool.query<ExerciseRow>(
      `SELECT ${columns}
       FROM exercises e JOIN source_pages p ON p.id = e.source_page_id
       WHERE e.source_page_id = $1
       ORDER BY e.exercise_number, e.part_label, e.created_at, e.id`,
      [sourcePageId],
    );
    return found.rows.map(toStored);
  }

  async get(exerciseId: string): Promise<StoredExercise | null> {
    const found = await this.pool.query<ExerciseRow>(
      `SELECT ${columns}
       FROM exercises e JOIN source_pages p ON p.id = e.source_page_id
       WHERE e.id = $1`,
      [exerciseId],
    );
    return found.rows[0] ? toStored(found.rows[0]) : null;
  }

  async listVerified(): Promise<VerifiedExerciseSummary[]> {
    const found = await this.pool.query<ExerciseRow>(
      `SELECT ${columns}
       FROM exercises e JOIN source_pages p ON p.id = e.source_page_id
       WHERE e.verification_state = 'verified'
       ORDER BY e.section_code, e.exercise_number, e.part_label, e.id`,
    );
    return found.rows.map((row) => toVerifiedSummary(toStored(row)));
  }

  async getVerified(
    exerciseId: string,
  ): Promise<VerifiedExerciseContext | null> {
    const found = await this.pool.query<ExerciseRow>(
      `SELECT ${columns}
       FROM exercises e JOIN source_pages p ON p.id = e.source_page_id
       WHERE e.id = $1 AND e.verification_state = 'verified'`,
      [exerciseId],
    );
    return found.rows[0] ? toVerified(toStored(found.rows[0])) : null;
  }

  async getVerifiedForInteraction(
    interactionId: string,
  ): Promise<VerifiedExerciseContext | null> {
    const found = await this.pool.query<ExerciseRow>(
      `SELECT ${columns}
       FROM interactions i
       JOIN exercises e ON e.id = i.exercise_id
       JOIN source_pages p ON p.id = e.source_page_id
       WHERE i.interaction_id = $1 AND e.verification_state = 'verified'`,
      [interactionId],
    );
    return found.rows[0] ? toVerified(toStored(found.rows[0])) : null;
  }

  async review(
    exerciseId: string,
    input: ExerciseReviewInput,
  ): Promise<StoredExercise> {
    const review = exerciseReviewInputSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<ExerciseRow>(
        `SELECT ${columns}
         FROM exercises e JOIN source_pages p ON p.id = e.source_page_id
         WHERE e.id = $1 FOR UPDATE OF e`,
        [exerciseId],
      );
      const row = found.rows[0];
      if (!row) throw new Error(`Exercise ${exerciseId} was not found.`);
      const current = toStored(row);
      const content =
        review.decision === 'correct'
          ? review.correction!
          : exerciseContent(current);
      const checksum = exerciseContentChecksum(content);
      const nextState: ExerciseVerificationState =
        review.decision === 'reject' ? 'rejected' : 'verified';
      const verifiedBy = nextState === 'verified' ? review.reviewer : null;
      const verifiedAt = nextState === 'verified' ? new Date() : null;
      const updated = await client.query<ExerciseRow>(
        `UPDATE exercises e SET
           source_page_id = $2, source_block_id = $3,
           source_bounding_box = $4::jsonb, section_code = $5,
           section_title = $6, exercise_number = $7, part_label = $8,
           topic = $9, prompt = $10, answer_payload = $11::jsonb,
           solution_text = $12, rubric = $13, difficulty = $14,
           grading_strategy = $15, verification_state = $16,
           content_checksum = $17, verified_by = $18, verified_at = $19,
           updated_at = CURRENT_TIMESTAMP
         FROM source_pages p
         WHERE e.id = $1 AND p.id = $2 AND p.printed_page_number IS NOT NULL
           AND (
             $3::uuid IS NULL OR EXISTS (
               SELECT 1 FROM source_blocks b
               WHERE b.id = $3 AND b.source_page_id = p.id AND b.deleted_at IS NULL
             )
           )
         RETURNING ${columns}`,
        valuesForReview(
          exerciseId,
          content,
          checksum,
          nextState,
          verifiedBy,
          verifiedAt,
        ),
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) {
        throw new Error(
          'The corrected source page or block is missing, mismatched, or lacks a printed page number.',
        );
      }
      const stored = toStored(updatedRow);
      await client.query(
        `INSERT INTO exercise_reviews (
           id, exercise_id, decision, snapshot, content_checksum, reviewer, notes
         ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          randomUUID(),
          exerciseId,
          review.decision,
          JSON.stringify(stored),
          checksum,
          review.reviewer,
          review.notes,
        ],
      );
      await client.query('COMMIT');
      return stored;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getImageReference(exerciseId: string): Promise<{
    imagePath: string;
    boundingBox: ExerciseDraftInput['sourceBoundingBox'];
  }> {
    const found = await this.pool.query<{
      page_image_key: string | null;
      source_bounding_box: ExerciseDraftInput['sourceBoundingBox'];
    }>(
      `SELECT p.page_image_key, e.source_bounding_box
       FROM exercises e JOIN source_pages p ON p.id = e.source_page_id
       WHERE e.id = $1`,
      [exerciseId],
    );
    const row = found.rows[0];
    if (!row?.page_image_key) {
      throw new Error(`Exercise ${exerciseId} has no source image.`);
    }
    return {
      imagePath: row.page_image_key,
      boundingBox: row.source_bounding_box,
    };
  }

  private async findBySourceIdentity(
    sourcePageId: string,
    exerciseNumber: string,
    partLabel: string,
  ): Promise<StoredExercise | null> {
    const found = await this.pool.query<ExerciseRow>(
      `SELECT ${columns}
       FROM exercises e JOIN source_pages p ON p.id = e.source_page_id
       WHERE e.source_page_id = $1 AND e.exercise_number = $2 AND e.part_label = $3`,
      [sourcePageId, exerciseNumber, partLabel],
    );
    return found.rows[0] ? toStored(found.rows[0]) : null;
  }
}

export function exerciseContentChecksum(input: ExerciseDraftInput): string {
  const content = exerciseDraftInputSchema.parse(input);
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function valuesForDraft(
  exerciseId: string,
  input: ExerciseDraftInput,
  checksum: string,
): unknown[] {
  return [
    exerciseId,
    input.sourcePageId,
    input.sourceBlockId,
    JSON.stringify(input.sourceBoundingBox),
    input.sectionCode,
    input.sectionTitle,
    input.exerciseNumber,
    input.partLabel,
    input.topic,
    input.prompt,
    JSON.stringify(input.answerPayload),
    input.solutionText,
    input.rubric,
    input.difficulty,
    input.gradingStrategy,
    checksum,
  ];
}

function valuesForReview(
  exerciseId: string,
  input: ExerciseDraftInput,
  checksum: string,
  state: ExerciseVerificationState,
  verifiedBy: string | null,
  verifiedAt: Date | null,
): unknown[] {
  return [
    exerciseId,
    input.sourcePageId,
    input.sourceBlockId,
    JSON.stringify(input.sourceBoundingBox),
    input.sectionCode,
    input.sectionTitle,
    input.exerciseNumber,
    input.partLabel,
    input.topic,
    input.prompt,
    JSON.stringify(input.answerPayload),
    input.solutionText,
    input.rubric,
    input.difficulty,
    input.gradingStrategy,
    state,
    checksum,
    verifiedBy,
    verifiedAt,
  ];
}

function exerciseContent(input: StoredExercise): ExerciseDraftInput {
  return exerciseDraftInputSchema.parse({
    sourcePageId: input.sourcePageId,
    sourceBlockId: input.sourceBlockId,
    sourceBoundingBox: input.sourceBoundingBox,
    sectionCode: input.sectionCode,
    sectionTitle: input.sectionTitle,
    exerciseNumber: input.exerciseNumber,
    partLabel: input.partLabel,
    topic: input.topic,
    prompt: input.prompt,
    answerPayload: input.answerPayload,
    solutionText: input.solutionText,
    rubric: input.rubric,
    difficulty: input.difficulty,
    gradingStrategy: input.gradingStrategy,
  });
}

function toStored(row: ExerciseRow): StoredExercise {
  const content = exerciseDraftInputSchema.parse({
    sourcePageId: row.source_page_id,
    sourceBlockId: row.source_block_id,
    sourceBoundingBox: row.source_bounding_box,
    sectionCode: row.section_code,
    sectionTitle: row.section_title,
    exerciseNumber: row.exercise_number,
    partLabel: row.part_label,
    topic: row.topic,
    prompt: row.prompt,
    answerPayload: row.answer_payload,
    solutionText: row.solution_text,
    rubric: row.rubric,
    difficulty: row.difficulty,
    gradingStrategy: row.grading_strategy,
  });
  return {
    exerciseId: row.id,
    sourceDocumentId: row.source_document_id,
    printedPageNumber: row.printed_page_number,
    ...content,
    verificationState: row.verification_state,
    contentChecksum: row.content_checksum,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toVerified(input: StoredExercise): VerifiedExerciseContext {
  return verifiedExerciseContextSchema.parse({
    ...exerciseContent(input),
    exerciseId: input.exerciseId,
    sourceDocumentId: input.sourceDocumentId,
    printedPageNumber: input.printedPageNumber,
    contentChecksum: input.contentChecksum,
    verificationState: input.verificationState,
    verifiedBy: input.verifiedBy,
    verifiedAt: input.verifiedAt,
  });
}

function toVerifiedSummary(input: StoredExercise): VerifiedExerciseSummary {
  const verified = toVerified(input);
  return verifiedExerciseSummarySchema.parse({
    exerciseId: verified.exerciseId,
    sourceDocumentId: verified.sourceDocumentId,
    sourcePageId: verified.sourcePageId,
    sourceBlockId: verified.sourceBlockId,
    printedPageNumber: verified.printedPageNumber,
    sectionCode: verified.sectionCode,
    sectionTitle: verified.sectionTitle,
    exerciseNumber: verified.exerciseNumber,
    partLabel: verified.partLabel,
    topic: verified.topic,
    difficulty: verified.difficulty,
    gradingStrategy: verified.gradingStrategy,
    contentChecksum: verified.contentChecksum,
    verifiedBy: verified.verifiedBy,
    verifiedAt: verified.verifiedAt,
  });
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original operation failure.
  }
}
