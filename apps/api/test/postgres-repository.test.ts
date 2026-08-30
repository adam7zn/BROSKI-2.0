import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DuplicateInteractionError,
  InteractionAlreadyCompletedError,
  InteractionIdMismatchError,
  InteractionNotFoundError,
  type InteractionRepository,
  type StoredInteraction,
} from '@math-study-companion/database';

import type { StoredDemoInteraction } from '../src/domain.js';
import { PostgresDemoInteractionRepositoryAdapter } from '../src/postgres-repository.js';

const completedAt = new Date('2026-08-28T12:34:56.000Z');
const flatInteraction: StoredInteraction = {
  interactionId: 'demo-001',
  exerciseId: null,
  topic: 'linear equations',
  sourceText: 'Solve equations by applying the same operation to both sides.',
  difficulty: 'easy',
  image: null,
  mode: 'PRACTISE',
  reason: 'Manual judge MVP demonstration',
  question: 'Solve 2x + 3 = 11.',
  studentReply: 'x = 4',
  feedback: 'Correct — subtract 3, then divide by 2.',
  result: 'correct',
  traceId: 'trace-001',
  createdAt: new Date('2026-08-28T12:00:00.000Z'),
  completedAt,
};
const nestedInteraction: StoredDemoInteraction = {
  interactionId: 'demo-001',
  exerciseId: null,
  traceId: 'trace-001',
  context: {
    interactionId: 'demo-001',
    topic: 'linear equations',
    sourceText: 'Solve equations by applying the same operation to both sides.',
    difficulty: 'easy',
    image: null,
    mode: 'PRACTISE',
    reason: 'Manual judge MVP demonstration',
  },
  result: {
    interactionId: 'demo-001',
    question: 'Solve 2x + 3 = 11.',
    studentReply: 'x = 4',
    feedback: 'Correct — subtract 3, then divide by 2.',
    result: 'correct',
  },
  startedAt: '2026-08-28T12:00:00.000Z',
  completedAt: '2026-08-28T12:34:56.000Z',
};

describe('PostgresDemoInteractionRepositoryAdapter', () => {
  it('maps flat database records to the nested API shape', async () => {
    const adapter = new PostgresDemoInteractionRepositoryAdapter(database());

    assert.deepEqual(await adapter.findById('demo-001'), nestedInteraction);
    assert.deepEqual(await adapter.list(), [nestedInteraction]);
  });

  it('maps an incomplete database record without inventing a result or timestamp', async () => {
    const incomplete: StoredInteraction = {
      ...flatInteraction,
      question: null,
      studentReply: null,
      feedback: null,
      result: null,
      completedAt: null,
    };
    const adapter = new PostgresDemoInteractionRepositoryAdapter(
      database({
        getByInteractionId: async () => incomplete,
        listRecent: async () => [incomplete],
      }),
    );

    assert.deepEqual(await adapter.findById('demo-001'), {
      ...nestedInteraction,
      result: null,
      completedAt: null,
    });
  });

  it('translates every typed database outcome and propagates unknown failures', async () => {
    const createDuplicate = new PostgresDemoInteractionRepositoryAdapter(
      database({
        start: async () => {
          throw new DuplicateInteractionError('demo-001');
        },
      }),
    );
    assert.equal(await createDuplicate.create(nestedInteraction), 'duplicate');

    const notFound = new PostgresDemoInteractionRepositoryAdapter(
      database({
        getByInteractionId: async () => {
          throw new InteractionNotFoundError('demo-001');
        },
        complete: async () => {
          throw new InteractionNotFoundError('demo-001');
        },
      }),
    );
    assert.equal(await notFound.findById('demo-001'), null);
    assert.equal(
      await notFound.saveResult(
        'demo-001',
        nestedInteraction.result!,
        completedAt.toISOString(),
      ),
      'not_found',
    );

    const completed = new PostgresDemoInteractionRepositoryAdapter(
      database({
        complete: async () => {
          throw new InteractionAlreadyCompletedError('demo-001');
        },
      }),
    );
    assert.equal(
      await completed.saveResult(
        'demo-001',
        nestedInteraction.result!,
        completedAt.toISOString(),
      ),
      'already_completed',
    );

    const mismatch = new PostgresDemoInteractionRepositoryAdapter(
      database({
        complete: async () => {
          throw new InteractionIdMismatchError('demo-001', 'demo-002');
        },
      }),
    );
    assert.equal(
      await mismatch.saveResult(
        'demo-001',
        { ...nestedInteraction.result!, interactionId: 'demo-002' },
        completedAt.toISOString(),
      ),
      'id_mismatch',
    );

    const unexpected = new Error('unexpected database failure');
    const broken = new PostgresDemoInteractionRepositoryAdapter(
      database({
        start: async () => {
          throw unexpected;
        },
      }),
    );
    await assert.rejects(broken.create(nestedInteraction), unexpected);
  });

  it('rejects inconsistent completion columns instead of creating partial API data', async () => {
    const adapter = new PostgresDemoInteractionRepositoryAdapter(
      database({
        getByInteractionId: async () => ({
          ...flatInteraction,
          feedback: null,
        }),
      }),
    );

    await assert.rejects(
      adapter.findById('demo-001'),
      /inconsistent completion fields/,
    );
  });
});

function database(
  overrides: Partial<InteractionRepository> = {},
): InteractionRepository {
  return {
    start: async () => flatInteraction,
    complete: async () => flatInteraction,
    getByInteractionId: async () => flatInteraction,
    listRecent: async () => [flatInteraction],
    saveDemoProfile: async () => {},
    getDemoProfile: async () => null,
    reserveDemoOutbound: async () => 'reserved',
    recordDemoMessageEvent: async () => 'recorded',
    listDemoMessageEvents: async () => [],
    ...overrides,
  };
}
