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
  clearJudgeDemoFixture,
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
  mode: 'PRACTISE',
  reason: 'Manual judge MVP demonstration',
};

const result: ConversationToBackend = {
  interactionId: 'demo-001',
  question: 'Solve 2x + 3 = 11.',
  studentReply: 'x = 4',
  feedback: 'Correct — subtract 3, then divide by 2.',
  result: 'correct',
};

const completedAt = new Date('2026-08-28T12:34:56.000Z');

describe('PostgresInteractionRepository', () => {
  const pool = new Pool({ connectionString });
  const repository = new PostgresInteractionRepository(pool);

  beforeAll(async () => {
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE demo_profiles, interactions CASCADE');
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
      completedAt: null,
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

    const completed = await repository.complete(context.interactionId, result, {
      completedAt,
    });
    const retrieved = await repository.getByInteractionId(
      context.interactionId,
    );

    expect(completed).toEqual(retrieved);
    expect(retrieved).toMatchObject({
      ...context,
      ...result,
      traceId: 'trace-001',
      completedAt,
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
    await repository.complete(context.interactionId, result, { completedAt });

    await expect(
      repository.complete(
        context.interactionId,
        {
          ...result,
          feedback: 'This later result must not replace the first.',
        },
        { completedAt: new Date('2026-08-29T00:00:00.000Z') },
      ),
    ).rejects.toBeInstanceOf(InteractionAlreadyCompletedError);
    await expect(
      repository.getByInteractionId(context.interactionId),
    ).resolves.toMatchObject({
      feedback: result.feedback,
      completedAt,
    });
  });

  it('rejects mismatched command and payload IDs without changing the row', async () => {
    await repository.start(context, { traceId: 'trace-001' });

    const mismatchedResult = { ...result, interactionId: 'demo-002' };

    await expect(
      repository.complete(context.interactionId, mismatchedResult, {
        completedAt,
      }),
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
      repository.complete(
        'missing-interaction',
        {
          ...result,
          interactionId: 'missing-interaction',
        },
        { completedAt },
      ),
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

  it('persists the profile and deduplicates messaging metadata', async () => {
    await repository.start(context, { traceId: 'judge-trace' });
    await repository.saveDemoProfile({
      profileId: 'demo-student',
      course: 'Mathematics 3c',
      selfAssessedLevel: 'okay',
      previousGrade: 'C',
      traceId: 'judge-trace',
      completedAt,
    });
    await expect(repository.getDemoProfile()).resolves.toMatchObject({
      course: 'Mathematics 3c',
      traceId: 'judge-trace',
    });

    const reservation = {
      interactionId: 'demo-001',
      idempotencyKey: 'demo-001:question',
      traceId: 'judge-trace',
      reservedAt: completedAt,
    };
    await expect(repository.reserveDemoOutbound(reservation)).resolves.toBe(
      'reserved',
    );
    await expect(repository.reserveDemoOutbound(reservation)).resolves.toBe(
      'duplicate',
    );

    const event = {
      id: '5b873e3c-7e5e-4baa-bc5a-1019d5b30ad6',
      interactionId: 'demo-001',
      traceId: 'judge-trace',
      provider: 'imessage-cli',
      direction: 'inbound' as const,
      eventType: 'received' as const,
      providerEventId: 'incoming-guid-1',
      providerMessageId: 'incoming-guid-1',
      idempotencyKey: null,
      occurredAt: completedAt.toISOString(),
      recordedAt: completedAt,
    };
    await expect(repository.recordDemoMessageEvent(event)).resolves.toBe(
      'recorded',
    );
    await expect(
      repository.recordDemoMessageEvent({ ...event, id: crypto.randomUUID() }),
    ).resolves.toBe('duplicate');
    await expect(
      repository.listDemoMessageEvents('demo-001'),
    ).resolves.toHaveLength(1);
  });

  it('clears only the guarded synthetic fixture', async () => {
    await expect(clearJudgeDemoFixture(pool, 'wrong')).rejects.toThrow(
      /--confirm demo-001/,
    );
    await repository.start(context, { traceId: 'judge-trace' });
    await repository.saveDemoProfile({
      profileId: 'demo-student',
      course: 'Mathematics 3c',
      selfAssessedLevel: 'okay',
      previousGrade: null,
      traceId: 'judge-trace',
      completedAt,
    });

    await expect(clearJudgeDemoFixture(pool, 'demo-001')).resolves.toEqual({
      interactions: 1,
      profiles: 1,
    });
    await expect(repository.getDemoProfile()).resolves.toBeNull();
    await expect(
      repository.getByInteractionId('demo-001'),
    ).rejects.toBeInstanceOf(InteractionNotFoundError);
  });
});
