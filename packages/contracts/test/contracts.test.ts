import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  backendToConversationSchema,
  conversationToBackendSchema,
  type BackendToConversation,
  type ConversationToBackend,
} from '@math-study-companion/contracts';

function loadFixture(name: string): unknown {
  const fixtureUrl = new URL(
    `../../../fixtures/contracts/${name}`,
    import.meta.url,
  );

  return JSON.parse(readFileSync(fixtureUrl, 'utf8'));
}

describe('backendToConversationSchema', () => {
  const fixture = loadFixture('backend-to-conversation.json') as Record<
    string,
    unknown
  >;

  it('accepts the canonical backend-to-conversation fixture unchanged', () => {
    const parsed: BackendToConversation =
      backendToConversationSchema.parse(fixture);

    expect(parsed).toEqual(fixture);
  });

  it.each([
    ['a missing required field', { topic: 'linear equations' }],
    ['an invalid image value', { ...fixture, image: 42 }],
    ['an additional field', { ...fixture, unexpected: true }],
  ])('rejects %s', (_description, value) => {
    expect(backendToConversationSchema.safeParse(value).success).toBe(false);
  });
});

describe('conversationToBackendSchema', () => {
  const fixture = loadFixture('conversation-to-backend.json') as Record<
    string,
    unknown
  >;

  it('accepts the canonical conversation-to-backend fixture unchanged', () => {
    const parsed: ConversationToBackend =
      conversationToBackendSchema.parse(fixture);

    expect(parsed).toEqual(fixture);
  });

  it.each([
    [
      'a missing required field',
      {
        interactionId: 'demo-001',
        question: 'Solve 2x + 3 = 11.',
      },
    ],
    ['an invalid result value', { ...fixture, result: false }],
    ['an additional field', { ...fixture, unexpected: true }],
  ])('rejects %s', (_description, value) => {
    expect(conversationToBackendSchema.safeParse(value).success).toBe(false);
  });
});
