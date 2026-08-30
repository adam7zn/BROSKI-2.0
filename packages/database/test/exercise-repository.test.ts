import { createHash, randomUUID } from 'node:crypto';

import type {
  ExerciseDraftInput,
  StructuredExtraction,
} from '@math-study-companion/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresExerciseRepository,
  PostgresSourceContentRepository,
  runMigrations,
} from '../src/index.js';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres@127.0.0.1:54329/math_study_companion';

describe('PostgresExerciseRepository', () => {
  const pool = new Pool({ connectionString });
  const sources = new PostgresSourceContentRepository(pool);
  const exercises = new PostgresExerciseRepository(pool);
  let sourcePageId = '';
  let sourceBlockId = '';

  beforeAll(async () => {
    await runMigrations(pool);
    const imported = await sources.importExtraction(syntheticExtraction());
    const page = (await sources.listPages(imported.documentId))[0]!;
    const detail = await sources.getPage(page.id);
    sourcePageId = page.id;
    sourceBlockId = detail.blocks[0]!.id;
  });

  afterAll(async () => pool.end());

  it('imports a draft idempotently and never exposes it before review', async () => {
    const input = draft(`S-${randomUUID()}`);
    const first = await exercises.createDraft(input);
    const second = await exercises.createDraft(input);

    expect(second.exerciseId).toBe(first.exerciseId);
    expect(first.verificationState).toBe('draft');
    await expect(exercises.getVerified(first.exerciseId)).resolves.toBeNull();
    expect(
      (await exercises.listVerified()).some(
        ({ exerciseId }) => exerciseId === first.exerciseId,
      ),
    ).toBe(false);
    await expect(
      exercises.createDraft({ ...input, prompt: 'Conflicting prompt' }),
    ).rejects.toThrow('different content');
  });

  it('makes an approved snapshot durable and keeps review evidence append-only', async () => {
    const stored = await exercises.createDraft(draft(`S-${randomUUID()}`));
    const verified = await exercises.review(stored.exerciseId, {
      decision: 'approve',
      reviewer: 'test-reviewer',
      notes: 'Synthetic approval only.',
      correction: null,
    });

    expect(verified.verificationState).toBe('verified');
    await expect(
      exercises.getVerified(stored.exerciseId),
    ).resolves.toMatchObject({
      exerciseId: stored.exerciseId,
      prompt: stored.prompt,
      verifiedBy: 'test-reviewer',
    });
    const restarted = new PostgresExerciseRepository(pool);
    await expect(
      restarted.getVerified(stored.exerciseId),
    ).resolves.toMatchObject({ contentChecksum: stored.contentChecksum });
    await expect(
      pool.query(`UPDATE exercise_reviews SET notes = 'changed'`),
    ).rejects.toThrow('append-only');
    await expect(pool.query(`DELETE FROM exercise_reviews`)).rejects.toThrow(
      'append-only',
    );
  });

  it('keeps rejected content unavailable and enforces RLS on private tables', async () => {
    const stored = await exercises.createDraft(draft(`S-${randomUUID()}`));
    await exercises.review(stored.exerciseId, {
      decision: 'reject',
      reviewer: 'test-reviewer',
      notes: null,
      correction: null,
    });
    await expect(exercises.getVerified(stored.exerciseId)).resolves.toBeNull();

    const security = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relname IN ('exercises', 'exercise_reviews')
       ORDER BY relname`,
    );
    expect(security.rows).toEqual([
      { relname: 'exercise_reviews', relrowsecurity: true },
      { relname: 'exercises', relrowsecurity: true },
    ]);
  });

  function draft(exerciseNumber: string): ExerciseDraftInput {
    return {
      sourcePageId,
      sourceBlockId,
      sourceBoundingBox: [0.1, 0.2, 0.7, 0.1],
      sectionCode: '1.1',
      sectionTitle: 'Synthetic Polynomials',
      exerciseNumber,
      partLabel: 'a',
      topic: 'Synthetic factorisation',
      prompt: 'Factor the synthetic polynomial x^2 - 9.',
      answerPayload: { canonical: '(x-3)(x+3)', accepted: [] },
      solutionText: 'Use the difference of two squares.',
      rubric: 'Accept an equivalent complete factorisation.',
      difficulty: 'medium',
      gradingStrategy: 'symbolic',
    };
  }
});

function syntheticExtraction(): StructuredExtraction {
  return {
    schemaVersion: 1,
    pipelineVersion: `exercise-test-${randomUUID()}`,
    documentTitle: 'Synthetic exercise source',
    inputChecksum: createHash('sha256')
      .update(`exercise-source-${randomUUID()}`)
      .digest('hex'),
    configuration: { externalRequests: false },
    pages: [
      {
        filePageNumber: 1,
        printedPageNumber: '13',
        imagePath: '/tmp/synthetic-page-013.jpg',
        width: 1_000,
        height: 1_500,
        blocks: [
          {
            sourceKey: 'synthetic-exercise-block',
            sequenceNumber: 1,
            blockType: 'exercise',
            boundingBox: [0.1, 0.2, 0.7, 0.1],
            confidence: 1,
            reviewReasons: [],
            candidates: [
              {
                engine: 'manual',
                passName: 'original',
                contentMarkdown: 'Synthetic source only.',
                latex: null,
                confidence: 1,
                metadata: {},
              },
            ],
          },
        ],
      },
    ],
  };
}
