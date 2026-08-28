import type {
  BackendToConversation,
  ConversationToBackend,
} from '@math-study-companion/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DuplicateInteractionError,
  InteractionAlreadyCompletedError,
  InteractionIdMismatchError,
  InteractionNotFoundError,
  PostgresInteractionRepository,
  runMigrations,
} from '../src/index.js';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres@127.0.0.1:54329/math_study_companion';

const context: BackendToConversation = {
  interactionId: 'demo-001',
  topic: 'linear equations',
  sourceText: 'Solve equations by applying the same operation to both sides.',
  difficulty: 'easy',
  image: null,
};

const result: ConversationToBackend = {
  interactionId: 'demo-001',
  question: 'Solve 2x + 3 = 11.',
  studentReply: 'x = 4',
  feedback: 'Correct — subtract 3, then divide by 2.',
  result: 'correct',
};

describe('PostgresInteractionRepository', () => {
  const pool = new Pool({ connectionString });
  const repository = new PostgresInteractionRepository(pool);

  beforeAll(async () => {
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE interactions');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('starts an interaction from the exact context payload', async () => {
    const stored = await repository.start(context, { traceId: 'trace-001' });

    expect(stored).toMatchObject({
      ...context,
      question: null,
      studentReply: null,
      feedback: null,
      result: null,
      traceId: 'trace-001',
    });
    expect(stored.createdAt).toBeInstanceOf(Date);
  });

  it('preserves a static image reference when one is supplied', async () => {
    const imageContext = {
      ...context,
      image: 'private-images://linear-equations/demo-001.svg',
    };

    await repository.start(imageContext, { traceId: 'trace-001' });

    await expect(
      repository.getByInteractionId(imageContext.interactionId),
    ).resolves.toMatchObject({ image: imageContext.image });
  });

  it('completes all result values atomically and retrieves the interaction', async () => {
    await repository.start(context, { traceId: 'trace-001' });

    const completed = await repository.complete(context.interactionId, result);
    const retrieved = await repository.getByInteractionId(
      context.interactionId,
    );

    expect(completed).toEqual(retrieved);
    expect(retrieved).toMatchObject({
      ...context,
      ...result,
      traceId: 'trace-001',
    });
  });

  it('returns a typed duplicate error for a repeated start', async () => {
    await repository.start(context, { traceId: 'trace-001' });

    const duplicate = repository.start(context, { traceId: 'trace-002' });

    await expect(duplicate).rejects.toMatchObject({
      name: 'DuplicateInteractionError',
      code: 'DUPLICATE_INTERACTION',
      interactionId: 'demo-001',
    });
    await expect(duplicate).rejects.toBeInstanceOf(DuplicateInteractionError);
  });

  it('does not overwrite the first completion', async () => {
    await repository.start(context, { traceId: 'trace-001' });
    await repository.complete(context.interactionId, result);

    await expect(
      repository.complete(context.interactionId, {
        ...result,
        feedback: 'This later result must not replace the first.',
      }),
    ).rejects.toBeInstanceOf(InteractionAlreadyCompletedError);
    await expect(
      repository.getByInteractionId(context.interactionId),
    ).resolves.toMatchObject({ feedback: result.feedback });
  });

  it('rejects mismatched command and payload IDs without changing the row', async () => {
    await repository.start(context, { traceId: 'trace-001' });

    const mismatchedResult = { ...result, interactionId: 'demo-002' };

    await expect(
      repository.complete(context.interactionId, mismatchedResult),
    ).rejects.toBeInstanceOf(InteractionIdMismatchError);
    await expect(
      repository.getByInteractionId(context.interactionId),
    ).resolves.toMatchObject({ question: null, result: null });
  });

  it('returns a typed not-found error', async () => {
    await expect(
      repository.getByInteractionId('missing-interaction'),
    ).rejects.toBeInstanceOf(InteractionNotFoundError);

    await expect(
      repository.complete('missing-interaction', {
        ...result,
        interactionId: 'missing-interaction',
      }),
    ).rejects.toMatchObject({
      code: 'INTERACTION_NOT_FOUND',
      interactionId: 'missing-interaction',
    });
  });

  it('lists recent interactions newest first with a bounded limit', async () => {
    for (const interactionId of ['demo-001', 'demo-002', 'demo-003']) {
      await repository.start(
        { ...context, interactionId },
        { traceId: `trace-${interactionId}` },
      );
    }
    await pool.query(
      `UPDATE interactions
       SET created_at = CASE interaction_id
         WHEN 'demo-001' THEN '2026-08-28T10:00:00Z'::timestamptz
         WHEN 'demo-002' THEN '2026-08-28T11:00:00Z'::timestamptz
         WHEN 'demo-003' THEN '2026-08-28T12:00:00Z'::timestamptz
       END`,
    );

    const recent = await repository.listRecent(2);

    expect(recent.map(({ interactionId }) => interactionId)).toEqual([
      'demo-003',
      'demo-002',
    ]);
    await expect(repository.listRecent(101)).rejects.toBeInstanceOf(RangeError);
  });
});
