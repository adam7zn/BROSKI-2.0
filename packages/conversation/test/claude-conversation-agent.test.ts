import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BackendToConversation,
  VerifiedExerciseContext,
} from '@math-study-companion/contracts';
import type Anthropic from '@anthropic-ai/sdk';

import {
  ClaudeConversationAgent,
  ClaudeStudyAgent,
  ModelOutputError,
  type AgentTurn,
  type GeneratedQuestion,
  type RespondInput,
  type StudyAgent,
} from '../src/index.js';

const context: BackendToConversation = {
  interactionId: 'verified-run-001',
  topic: 'synthetic factorisation',
  sourceText: 'Factor x^2 - 9.',
  difficulty: 'medium',
  image: null,
  mode: 'PRACTISE',
  reason: 'Manual verified exercise',
};

const exercise: VerifiedExerciseContext = {
  exerciseId: '11111111-1111-4111-8111-111111111111',
  sourceDocumentId: '22222222-2222-4222-8222-222222222222',
  sourcePageId: '33333333-3333-4333-8333-333333333333',
  sourceBlockId: '44444444-4444-4444-8444-444444444444',
  sourceBoundingBox: [0.1, 0.2, 0.7, 0.1],
  printedPageNumber: '13',
  sectionCode: '1.1',
  sectionTitle: 'Synthetic Polynomials',
  exerciseNumber: 'S-101',
  partLabel: 'a',
  topic: 'Synthetic factorisation',
  prompt: 'Factor x^2 - 9.',
  answerPayload: { canonical: '(x-3)(x+3)', accepted: [] },
  solutionText: 'Use the difference of two squares.',
  rubric: 'Accept an algebraically equivalent complete factorisation.',
  difficulty: 'medium',
  gradingStrategy: 'symbolic',
  contentChecksum: 'a'.repeat(64),
  verificationState: 'verified',
  verifiedBy: 'test-reviewer',
  verifiedAt: '2026-08-30T08:00:00.000Z',
};

test('keeps onboarding deterministic before sending the exact verified question', async () => {
  const agent = new ClaudeConversationAgent({
    studyAgent: new CapturingStudyAgent({
      intent: 'feedback',
      message: 'unused',
      status: 'resolved',
      result: 'unclear',
      confidence: 0,
      deterministic: false,
      meta: { agent: 'unused', model: null, promptVersion: 'unused' },
    }),
  });
  const started = await agent.startSession({
    context,
    profile: null,
    exercise,
    traceId: 'trace-onboarding',
  });
  assert.equal(started.outbound[0]?.purpose, 'onboarding-course');

  const course = await onboardingReply(
    agent,
    started.agentState,
    'Matematik 3c',
  );
  assert.equal(course.outbound[0]?.purpose, 'onboarding-level');
  const level = await onboardingReply(agent, course.agentState, 'okay');
  assert.equal(level.outbound[0]?.purpose, 'onboarding-grade');
  const grade = await onboardingReply(agent, level.agentState, 'SKIP');

  assert.equal(grade.outbound[1]?.text, exercise.prompt);
  assert.deepEqual(grade.profile, {
    course: 'Matematik 3c',
    selfAssessedLevel: 'okay',
    previousGrade: null,
  });
  assert.deepEqual(grade.agentState, { step: 'answer' });
});

test('sends the verified question unchanged and gives Claude only its bounded context', async () => {
  const studyAgent = new CapturingStudyAgent({
    intent: 'hint',
    message: 'Try recognizing a difference of squares.',
    status: 'waiting',
    result: null,
    confidence: 0.9,
    deterministic: false,
    meta: { agent: 'claude', model: 'fake-claude', promptVersion: 'test' },
  });
  const agent = new ClaudeConversationAgent({ studyAgent });
  const started = await agent.startSession({
    context,
    profile: {
      course: 'Mathematics 3c',
      selfAssessedLevel: 'okay',
      previousGrade: null,
    },
    exercise,
    traceId: 'trace-1',
  });
  assert.equal(started.outbound[0]?.text, exercise.prompt);

  const output = await agent.handleInbound({
    interactionId: context.interactionId,
    context,
    exercise,
    text: 'Can I have a hint?',
    receivedAt: '2026-08-30T08:01:00.000Z',
    history: [
      {
        direction: 'outbound',
        text: 'Which maths course are you taking?',
        occurredAt: '2026-08-30T07:58:00.000Z',
      },
      {
        direction: 'inbound',
        text: 'Private onboarding answer',
        occurredAt: '2026-08-30T07:58:30.000Z',
      },
      {
        direction: 'outbound',
        text: exercise.prompt,
        occurredAt: '2026-08-30T08:00:30.000Z',
      },
    ],
    agentState: started.agentState,
    traceId: 'trace-1',
  });

  assert.equal(output.status, 'waiting');
  assert.equal(output.outbound[0]?.purpose, 'hint');
  assert.equal(studyAgent.lastInput?.question.question, exercise.prompt);
  assert.equal(
    studyAgent.lastInput?.question.expectedAnswer,
    exercise.answerPayload.canonical,
  );
  assert.equal(studyAgent.lastInput?.question.rubric, exercise.rubric);
  assert.equal(studyAgent.lastInput?.context.sourceText, exercise.prompt);
  assert.equal(
    JSON.stringify(studyAgent.lastInput?.transcript).includes(
      'Private onboarding answer',
    ),
    false,
  );
});

test('forces resolution at the six-turn limit and records the final reply', async () => {
  const studyAgent = new CapturingStudyAgent({
    intent: 'feedback',
    message: 'I cannot verify that answer, so this attempt is unclear.',
    status: 'resolved',
    result: 'unclear',
    confidence: 0.4,
    deterministic: false,
    meta: { agent: 'claude', model: 'fake-claude', promptVersion: 'test' },
  });
  const agent = new ClaudeConversationAgent({ studyAgent });
  const output = await agent.handleInbound({
    interactionId: context.interactionId,
    context,
    exercise,
    text: 'I still do not know',
    receivedAt: '2026-08-30T08:06:00.000Z',
    history: [],
    agentState: { step: 'answer', hintsGiven: '2', studentTurns: '5' },
    traceId: 'trace-1',
  });

  assert.equal(studyAgent.lastInput?.canContinue, false);
  assert.equal(studyAgent.lastInput?.hintsGiven, 2);
  assert.equal(output.status, 'completed');
  assert.equal(output.result?.studentReply, 'I still do not know');
  assert.equal(output.result?.result, 'unclear');
});

test('answers a bounded follow-up without replacing the completed result', async () => {
  let capturedMessage = '';
  const agent = new ClaudeConversationAgent({
    studyAgent: {
      askQuestion: async () => {
        throw new Error('unused');
      },
      respond: async () => {
        throw new Error('unused');
      },
      followUp: async (input) => {
        capturedMessage = input.message;
        return {
          related: true,
          message: 'Because substituting x = 0 removes both x terms.',
          confidence: 0.95,
          meta: {
            agent: 'claude-follow-up',
            model: 'fake-claude',
            promptVersion: 'test-follow-up',
          },
        };
      },
    },
  });

  const output = await agent.handleInbound({
    interactionId: context.interactionId,
    context,
    exercise,
    text: 'Why does that work?',
    receivedAt: '2026-08-30T08:07:00.000Z',
    history: [
      {
        direction: 'outbound',
        text: exercise.prompt,
        occurredAt: '2026-08-30T08:00:00.000Z',
      },
      {
        direction: 'inbound',
        text: exercise.answerPayload.canonical,
        occurredAt: '2026-08-30T08:01:00.000Z',
      },
    ],
    agentState: { step: 'complete' },
    traceId: 'trace-1',
  });

  assert.equal(capturedMessage, 'Why does that work?');
  assert.equal(output.status, 'waiting');
  assert.equal(output.result, null);
  assert.equal(output.outbound[0]?.purpose, 'follow-up');
});

test('enforces the unrelated follow-up boundary returned by Claude', async () => {
  const agent = new ClaudeStudyAgent({
    client: fakeAnthropicClient(async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            related: false,
            message: 'An unsafe unrelated answer.',
            confidence: 0.99,
          }),
        },
      ],
    })),
  });
  const input = claudeRespondInput();
  const turn = await agent.followUp({
    context: input.context,
    question: input.question,
    transcript: input.transcript,
    message: 'Tell me something unrelated.',
  });

  assert.equal(turn.related, false);
  assert.match(turn.message, /only help with the textbook exercise/i);
  assert.equal(turn.message.includes('unsafe unrelated'), false);
});

test('uses the fixed boundary for a low-confidence related classification', async () => {
  const agent = new ClaudeStudyAgent({
    client: fakeAnthropicClient(async () => ({
      parsed_output: {
        related: true,
        message: 'An uncertain answer that must not be sent.',
        confidence: 0.3,
      },
    })),
  });
  const input = claudeRespondInput();
  const turn = await agent.followUp({
    context: input.context,
    question: input.question,
    transcript: input.transcript,
    message: 'Maybe explain it?',
  });

  assert.equal(turn.related, false);
  assert.match(turn.message, /only help with the textbook exercise/i);
  assert.equal(turn.message.includes('uncertain answer'), false);
});

test('propagates model failures so the durable worker can fail closed', async () => {
  const agent = new ClaudeConversationAgent({
    studyAgent: {
      askQuestion: async (): Promise<GeneratedQuestion> => {
        throw new Error('unused');
      },
      respond: async () => {
        throw new Error('simulated model timeout');
      },
    },
  });
  await assert.rejects(
    agent.handleInbound({
      interactionId: context.interactionId,
      context,
      exercise,
      text: 'answer',
      receivedAt: '2026-08-30T08:01:00.000Z',
      history: [],
      agentState: { step: 'answer' },
      traceId: 'trace-1',
    }),
    /simulated model timeout/,
  );
});

test('rejects a Claude response without schema-valid structured output', async () => {
  const agent = new ClaudeStudyAgent({
    client: fakeAnthropicClient(async () => ({ parsed_output: null })),
  });

  await assert.rejects(
    agent.respond(claudeRespondInput()),
    (error: unknown) =>
      error instanceof ModelOutputError &&
      error.message.includes('schema-valid output'),
  );
});

test('propagates Claude timeout and rate-limit failures without inventing feedback', async () => {
  for (const providerFailure of [
    new Error('simulated Anthropic timeout'),
    new Error('simulated Anthropic rate limit'),
  ]) {
    const agent = new ClaudeStudyAgent({
      client: fakeAnthropicClient(async () => {
        throw providerFailure;
      }),
    });

    await assert.rejects(agent.respond(claudeRespondInput()), providerFailure);
  }
});

test('resolves an exact verified answer before calling Claude', async () => {
  let modelCalled = false;
  const agent = new ClaudeStudyAgent({
    client: fakeAnthropicClient(async () => {
      modelCalled = true;
      throw new Error('Claude must not be called for an exact verified answer');
    }),
  });
  const input = claudeRespondInput();
  input.question.expectedAnswer = '-7';
  input.transcript[input.transcript.length - 1] = {
    role: 'student',
    text: '-7',
    at: '2026-08-30T08:01:00.000Z',
  };

  const turn = await agent.respond(input);

  assert.equal(modelCalled, false);
  assert.equal(turn.status, 'resolved');
  assert.equal(turn.result, 'correct');
  assert.equal(turn.deterministic, true);
});

test('rejects model output that exceeds the hint or turn limits', async () => {
  const hintAgent = new ClaudeStudyAgent({
    client: fakeAnthropicClient(async () => ({
      parsed_output: {
        intent: 'hint',
        message: 'A third hint that must not be delivered.',
        result: null,
        confidence: 0.9,
      },
    })),
  });
  await assert.rejects(
    hintAgent.respond({ ...claudeRespondInput(), hintsGiven: 2 }),
    ModelOutputError,
  );

  const finalTurnAgent = new ClaudeStudyAgent({
    client: fakeAnthropicClient(async () => ({
      parsed_output: {
        intent: 'clarify',
        message: 'One more question that must not be delivered.',
        result: null,
        confidence: 0.9,
      },
    })),
  });
  await assert.rejects(
    finalTurnAgent.respond({ ...claudeRespondInput(), canContinue: false }),
    ModelOutputError,
  );
});

class CapturingStudyAgent implements StudyAgent {
  lastInput: RespondInput | null = null;

  constructor(private readonly turn: AgentTurn) {}

  async askQuestion(): Promise<GeneratedQuestion> {
    throw new Error('The adapter must not ask Claude to invent a question.');
  }

  async respond(input: RespondInput): Promise<AgentTurn> {
    this.lastInput = input;
    return this.turn;
  }
}

function fakeAnthropicClient(
  parse: (...args: unknown[]) => Promise<unknown>,
): Anthropic {
  return {
    messages: { parse, create: parse },
  } as unknown as Anthropic;
}

function claudeRespondInput(): RespondInput {
  return {
    context: {
      interactionId: context.interactionId,
      topic: exercise.topic,
      difficulty: exercise.difficulty,
      sourceText: exercise.prompt,
      image: null,
      mode: 'PRACTISE',
      reason: 'Manual verified exercise',
    },
    question: {
      question: exercise.prompt,
      expectedAnswer: exercise.answerPayload.canonical,
      rubric: exercise.rubric,
      meta: {
        agent: 'verified-exercise',
        promptVersion: 'verified-exercise-v1',
        model: null,
      },
    },
    transcript: [
      {
        role: 'companion',
        text: exercise.prompt,
        at: '2026-08-30T08:00:30.000Z',
      },
      {
        role: 'student',
        text: 'I am not sure.',
        at: '2026-08-30T08:01:00.000Z',
      },
    ],
    hintsGiven: 0,
    canContinue: true,
  };
}

function onboardingReply(
  agent: ClaudeConversationAgent,
  agentState: unknown,
  text: string,
) {
  return agent.handleInbound({
    interactionId: context.interactionId,
    context,
    exercise,
    text,
    receivedAt: '2026-08-30T08:01:00.000Z',
    history: [],
    agentState,
    traceId: 'trace-onboarding',
  });
}
