import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const loadFixture = async (name: string): Promise<unknown> => {
  const fixtureUrl = new URL(`../fixtures/contracts/${name}`, import.meta.url);

  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as unknown;
};

describe('Phase 0 boundary fixtures', () => {
  it('keeps the backend-to-conversation example exact', async () => {
    await expect(loadFixture('backend-to-conversation.json')).resolves.toEqual({
      interactionId: 'demo-001',
      topic: 'linear equations',
      sourceText:
        'Solve equations by applying the same operation to both sides.',
      difficulty: 'easy',
      image: null,
    });
  });

  it('keeps the conversation-to-backend example exact', async () => {
    await expect(loadFixture('conversation-to-backend.json')).resolves.toEqual({
      interactionId: 'demo-001',
      question: 'Solve 2x + 3 = 11.',
      studentReply: 'x = 4',
      feedback: 'Correct — subtract 3, then divide by 2.',
      result: 'correct',
    });
  });
});
