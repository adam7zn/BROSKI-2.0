import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  PostgresHostedMessagingRepository,
  PostgresInteractionRepository,
  clearJudgeDemoFixture,
  inspectMigrationLedger,
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
const migrationsDirectory = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

describe('PostgresInteractionRepository', () => {
  const pool = new Pool({ connectionString });
  const repository = new PostgresInteractionRepository(pool);
  const messaging = new PostgresHostedMessagingRepository(pool);

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

  it('durably deduplicates and transactionally claims hosted inbox/outbox rows', async () => {
    await repository.start(context, { traceId: 'hosted-trace' });
    const createdAt = '2026-08-29T12:00:00.000Z';
    await expect(
      messaging.createSession(
        {
          interactionId: 'demo-001',
          provider: 'sendblue',
          participantAddress: '+46700000000',
          providerLine: '+13470000000',
          status: 'active',
          turnNumber: 0,
          agentState: { step: 'course' },
          lastPromptAt: null,
          traceId: 'hosted-trace',
          failureCode: null,
          createdAt,
          updatedAt: createdAt,
        },
        [
          {
            interactionId: 'demo-001',
            idempotencyKey: 'demo-001:turn:0:00:onboarding-course',
            turnNumber: 0,
            purpose: 'onboarding-course',
            content: 'Which maths course are you taking?',
            mediaUrl: null,
            traceId: 'hosted-trace',
            createdAt,
          },
        ],
      ),
    ).resolves.toBe('created');

    const competingWorker = new PostgresHostedMessagingRepository(pool);
    const outboundClaims = await Promise.all([
      messaging.claimOutbound({
        now: createdAt,
        staleBefore: '2026-08-29T11:59:00.000Z',
      }),
      competingWorker.claimOutbound({
        now: createdAt,
        staleBefore: '2026-08-29T11:59:00.000Z',
      }),
    ]);
    expect(outboundClaims.filter((claim) => claim !== null)).toHaveLength(1);
    const outbound = outboundClaims.find((claim) => claim !== null)!;
    expect(outbound?.attemptCount).toBe(1);
    await messaging.markOutboundAccepted({
      message: outbound!,
      providerMessageId: 'sendblue-out-1',
      acceptedAt: createdAt,
      event: {
        provider: 'sendblue',
        direction: 'outbound',
        eventType: 'accepted',
        providerEventId: 'sendblue-out-1',
        providerMessageId: 'sendblue-out-1',
        idempotencyKey: outbound!.idempotencyKey,
        occurredAt: createdAt,
      },
      now: createdAt,
    });

    const message = {
      provider: 'sendblue',
      providerEventId: 'sendblue-in-1',
      providerMessageId: 'sendblue-in-1',
      interactionId: 'demo-001',
      turnNumber: 0,
      senderAddress: '+46700000000',
      content: 'Mathematics 3c',
      receivedAt: '2026-08-29T12:00:01.000Z',
      processingStatus: 'pending' as const,
      attemptCount: 0,
      errorCode: null,
      traceId: 'hosted-trace',
      createdAt: '2026-08-29T12:00:01.000Z',
      updatedAt: '2026-08-29T12:00:01.000Z',
      processedAt: null,
    };
    const inboundEvent = {
      provider: 'sendblue',
      direction: 'inbound' as const,
      eventType: 'received' as const,
      providerEventId: 'sendblue-in-1',
      providerMessageId: 'sendblue-in-1',
      idempotencyKey: null,
      occurredAt: '2026-08-29T12:00:01.000Z',
    };
    const outcomes = await Promise.all([
      messaging.enqueueInbound({ message, event: inboundEvent }),
      messaging.enqueueInbound({ message, event: inboundEvent }),
    ]);
    expect(outcomes.sort()).toEqual(['duplicate', 'queued']);

    const restarted = new PostgresHostedMessagingRepository(pool);
    await expect(restarted.findSession('demo-001')).resolves.toMatchObject({
      lastPromptAt: createdAt,
      status: 'active',
    });
    const claimed = await restarted.claimInbound({
      now: '2026-08-29T12:00:02.000Z',
      staleBefore: '2026-08-29T12:00:00.000Z',
    });
    expect(claimed).toMatchObject({
      providerEventId: 'sendblue-in-1',
      processingStatus: 'processing',
      attemptCount: 1,
    });
    await expect(
      restarted.claimInbound({
        now: '2026-08-29T12:00:02.000Z',
        staleBefore: '2026-08-29T12:00:00.000Z',
      }),
    ).resolves.toBeNull();
    const reclaimed = await new PostgresHostedMessagingRepository(
      pool,
    ).claimInbound({
      now: '2026-08-29T12:04:00.000Z',
      staleBefore: '2026-08-29T12:03:00.000Z',
    });
    expect(reclaimed).toMatchObject({
      providerEventId: 'sendblue-in-1',
      processingStatus: 'processing',
      attemptCount: 2,
    });

    const completion = {
      outbound: [
        {
          purpose: 'feedback',
          text: result.feedback,
          mediaUrl: null,
        },
      ],
      agentState: { step: 'complete' },
      profile: null,
      result,
      status: 'completed' as const,
    };
    const feedback = {
      interactionId: 'demo-001',
      idempotencyKey: 'demo-001:turn:1:intent:00',
      turnNumber: 1,
      purpose: 'feedback',
      content: result.feedback,
      mediaUrl: null,
      traceId: 'hosted-trace',
      createdAt: '2026-08-29T12:04:01.000Z',
    };
    await expect(
      restarted.completeInbound({
        message: reclaimed!,
        output: completion,
        outbounds: [feedback],
        now: feedback.createdAt,
      }),
    ).resolves.toBe('completed');
    await expect(
      repository.getByInteractionId('demo-001'),
    ).resolves.toMatchObject({
      ...result,
      completedAt: new Date(feedback.createdAt),
    });
    await expect(restarted.findSession('demo-001')).resolves.toMatchObject({
      status: 'completed',
      turnNumber: 1,
      agentState: { step: 'complete' },
    });
    await expect(restarted.listOutbox('demo-001')).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: 'demo-001:turn:0:00:onboarding-course',
        deliveryStatus: 'accepted',
      }),
      expect.objectContaining({
        idempotencyKey: feedback.idempotencyKey,
        deliveryStatus: 'pending',
        content: result.feedback,
      }),
    ]);
    await expect(
      competingWorker.completeInbound({
        message: reclaimed!,
        output: completion,
        outbounds: [feedback],
        now: '2026-08-29T12:05:00.000Z',
      }),
    ).resolves.toBe('lost_claim');
    await expect(restarted.listOutbox('demo-001')).resolves.toHaveLength(2);
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

describe('migration ledger reconciliation', () => {
  it('accepts the legacy completed-at filename and applies only forward local migrations', async () => {
    const admin = new Pool({ connectionString });
    const schema = `migration_legacy_${crypto.randomUUID().replaceAll('-', '')}`;
    const legacyDirectory = await mkdtemp(
      join(tmpdir(), 'msc-legacy-migrations-'),
    );
    await copyFile(
      join(migrationsDirectory, '0001_create_interactions.sql'),
      join(legacyDirectory, '0001_create_interactions.sql'),
    );
    await copyFile(
      join(migrationsDirectory, '0003_add_completed_at.sql'),
      join(legacyDirectory, '0002_add_completed_at.sql'),
    );
    await admin.query(`CREATE SCHEMA ${schema}`);
    const isolated = new Pool({
      connectionString,
      options: `-c search_path=${schema}`,
    });

    try {
      await runMigrations(isolated, legacyDirectory);
      const before = await inspectMigrationLedger(
        isolated,
        migrationsDirectory,
      );
      expect(before).toContainEqual({
        name: '0002_add_completed_at.sql',
        state: 'applied_alias',
        equivalentLocalName: '0003_add_completed_at.sql',
      });
      expect(before).toContainEqual({
        name: '0003_add_completed_at.sql',
        state: 'pending',
      });

      await runMigrations(isolated, migrationsDirectory);
      const after = await inspectMigrationLedger(isolated, migrationsDirectory);
      expect(after.some(({ state }) => state === 'pending')).toBe(false);
      expect(after.some(({ state }) => state === 'checksum_mismatch')).toBe(
        false,
      );
      expect(after).toContainEqual({
        name: '0002_add_completed_at.sql',
        state: 'applied_alias',
        equivalentLocalName: '0003_add_completed_at.sql',
      });
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });
});
