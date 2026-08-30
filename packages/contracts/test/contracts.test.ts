import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  backendToConversationSchema,
  conversationAgentOutputSchema,
  conversationToBackendSchema,
  demoMessageEventInputSchema,
  demoOutboundReservationInputSchema,
  demoProfileInputSchema,
  exerciseReviewInputSchema,
  pilotExerciseDraftManifestSchema,
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

  it('accepts the canonical backend-to-conversation fixture with defaults', () => {
    const parsed: BackendToConversation =
      backendToConversationSchema.parse(fixture);

    expect(parsed).toEqual({
      ...fixture,
      mode: 'PRACTISE',
      reason: 'Manual judge MVP demonstration',
    });
  });

  it.each([
    ['a missing required field', { topic: 'linear equations' }],
    ['an invalid image value', { ...fixture, image: 42 }],
    ['an additional field', { ...fixture, unexpected: true }],
  ])('rejects %s', (_description, value) => {
    expect(backendToConversationSchema.safeParse(value).success).toBe(false);
  });
});

describe('judge MVP contracts', () => {
  it('accepts the minimal profile and rejects unknown fields', () => {
    const profile = {
      course: 'Mathematics 3c',
      selfAssessedLevel: 'okay',
      previousGrade: 'C',
    };

    expect(demoProfileInputSchema.parse(profile)).toEqual(profile);
    expect(
      demoProfileInputSchema.safeParse({ ...profile, name: 'William' }).success,
    ).toBe(false);
    expect(
      demoProfileInputSchema.safeParse({
        ...profile,
        selfAssessedLevel: 'excellent',
      }).success,
    ).toBe(false);
    expect(
      demoProfileInputSchema.safeParse({ ...profile, course: '   ' }).success,
    ).toBe(false);
  });

  it('validates outbound reservations and normalized events', () => {
    expect(
      demoOutboundReservationInputSchema.safeParse({
        idempotencyKey: 'demo-001:onboarding:course',
      }).success,
    ).toBe(true);
    expect(
      demoMessageEventInputSchema.safeParse({
        provider: 'imessage-cli',
        direction: 'inbound',
        eventType: 'received',
        providerEventId: 'message-guid-1',
        providerMessageId: 'message-guid-1',
        idempotencyKey: null,
        occurredAt: '2026-08-29T08:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      demoMessageEventInputSchema.safeParse({
        provider: 'imessage-cli',
        direction: 'inbound',
        eventType: 'received',
        providerEventId: null,
        providerMessageId: null,
        idempotencyKey: null,
        occurredAt: '2026-08-29T08:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      demoMessageEventInputSchema.safeParse({
        provider: 'sendblue',
        direction: 'outbound',
        eventType: 'delivered',
        providerEventId: 'handle-1:DELIVERED',
        providerMessageId: 'handle-1',
        idempotencyKey: 'demo-001:turn:0:intent:00',
        occurredAt: '2026-08-29T08:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('validates agent output and HTTPS-only media intents', () => {
    const output = {
      outbound: [
        {
          purpose: 'question',
          text: 'Solve 2x + 3 = 11.',
          mediaUrl: null,
        },
      ],
      agentState: { step: 'answer' },
      profile: null,
      result: null,
      status: 'waiting',
    };
    expect(conversationAgentOutputSchema.safeParse(output).success).toBe(true);
    expect(
      conversationAgentOutputSchema.safeParse({
        ...output,
        outbound: [
          { purpose: 'image', text: null, mediaUrl: 'file:///tmp/private.png' },
        ],
      }).success,
    ).toBe(false);
    expect(
      conversationAgentOutputSchema.safeParse({
        ...output,
        outbound: [{ purpose: 'empty', text: null, mediaUrl: null }],
      }).success,
    ).toBe(false);
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

describe('verified exercise contracts', () => {
  it('requires correction content only for a correction review', () => {
    expect(
      exerciseReviewInputSchema.safeParse({ decision: 'approve' }).success,
    ).toBe(true);
    expect(
      exerciseReviewInputSchema.safeParse({ decision: 'correct' }).success,
    ).toBe(false);
    expect(
      exerciseReviewInputSchema.safeParse({
        decision: 'reject',
        correction: exerciseItem(0),
      }).success,
    ).toBe(false);
  });

  it('accepts only the exact 20-question pilot distribution', () => {
    const exercises = Array.from({ length: 20 }, (_, index) =>
      exerciseItem(index),
    );
    const manifest = {
      schemaVersion: 1,
      sourceDocumentChecksum: 'a'.repeat(64),
      exercises,
    };
    expect(
      pilotExerciseDraftManifestSchema.parse(manifest).exercises,
    ).toHaveLength(20);
    expect(
      pilotExerciseDraftManifestSchema.safeParse({
        ...manifest,
        exercises: exercises.map((exercise) => ({
          ...exercise,
          sectionCode: '1.1',
        })),
      }).success,
    ).toBe(false);
    expect(
      pilotExerciseDraftManifestSchema.safeParse({
        ...manifest,
        exercises: exercises.map((exercise) => ({
          ...exercise,
          difficulty: 'easy',
        })),
      }).success,
    ).toBe(false);
  });
});

function exerciseItem(index: number) {
  return {
    printedPageNumber: String(8 + index),
    sourceBlockSequenceNumber: index + 1,
    sourceBoundingBox: [0.1, 0.1, 0.8, 0.1] as const,
    sectionCode: index < 6 ? '1.1' : index < 13 ? '1.2' : '1.3',
    sectionTitle:
      index < 6
        ? 'Polynom'
        : index < 13
          ? 'Polynomekvationer'
          : 'Rationella uttryck',
    exerciseNumber: `synthetic-${index + 1}`,
    partLabel: 'a',
    topic: 'Synthetic algebra',
    prompt: `Synthetic question ${index + 1}`,
    answerPayload: { canonical: String(index + 1), accepted: [] },
    solutionText: `Synthetic solution ${index + 1}`,
    rubric: 'Compare the final value.',
    difficulty: index < 10 ? 'easy' : index < 16 ? 'medium' : 'hard',
    gradingStrategy: 'numeric' as const,
  };
}
