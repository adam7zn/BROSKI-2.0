import {
  conversationAgentOutputSchema,
  type ConversationAgentOutput,
  type VerifiedExerciseContext,
} from '@math-study-companion/contracts';

import {
  MAX_STUDENT_TURNS,
  type GeneratedQuestion,
  type StudyAgent,
  type TranscriptEntry,
} from './agent/types.js';
import { ClaudeStudyAgent } from './agent/claude-agent.js';
import {
  DeterministicDemoAgent,
  type AgentInboundTurnInput,
  type AgentSessionStartInput,
  type ConversationAgent,
} from './agent.js';
import { CANONICAL_QUESTION } from './canonical-session.js';

const VERIFIED_QUESTION_VERSION = 'verified-source/2026-08-30.1';

export interface ClaudeConversationAgentOptions {
  studyAgent?: StudyAgent;
}

/**
 * Adapts the richer model-backed StudyAgent to the durable hosted boundary.
 * Onboarding and transport remain deterministic; Claude sees only the one
 * verified exercise and the relevant conversation transcript.
 */
export class ClaudeConversationAgent implements ConversationAgent {
  readonly #onboarding = new DeterministicDemoAgent();
  readonly #studyAgent: StudyAgent;

  constructor(options: ClaudeConversationAgentOptions = {}) {
    this.#studyAgent = options.studyAgent ?? new ClaudeStudyAgent();
  }

  startSession(
    input: AgentSessionStartInput,
  ): Promise<ConversationAgentOutput> {
    return this.#onboarding.startSession(input);
  }

  async handleInbound(
    input: AgentInboundTurnInput,
  ): Promise<ConversationAgentOutput> {
    const state = parseState(input.agentState);
    if (state.step !== 'answer') {
      return this.#onboarding.handleInbound(input);
    }

    const reply = input.text.trim();
    if (!reply) throw new Error('Agent received an empty inbound message');
    const studentTurns = state.studentTurns + 1;
    const question = questionFrom(input.exercise);
    const history = relevantStudyHistory(input.history, question.question);
    const transcript: TranscriptEntry[] = [
      ...history.map(
        (entry) =>
          ({
            role: entry.direction === 'outbound' ? 'companion' : 'student',
            text: entry.text,
            at: entry.occurredAt,
          }) satisfies TranscriptEntry,
      ),
      { role: 'student', text: reply, at: input.receivedAt },
    ];
    const turn = await this.#studyAgent.respond({
      context: input.context,
      question,
      transcript,
      hintsGiven: state.hintsGiven,
      canContinue: studentTurns < MAX_STUDENT_TURNS,
    });
    const hintsGiven = state.hintsGiven + (turn.intent === 'hint' ? 1 : 0);
    const agentState = {
      step: turn.status === 'resolved' ? 'complete' : 'answer',
      hintsGiven: String(hintsGiven),
      studentTurns: String(studentTurns),
      agent: turn.meta.agent,
      model: turn.meta.model ?? 'none',
      promptVersion: turn.meta.promptVersion,
      confidence: String(turn.confidence),
      deterministic: String(turn.deterministic),
    };

    return conversationAgentOutputSchema.parse({
      outbound: [
        {
          purpose: turn.intent,
          text: turn.message,
          mediaUrl: null,
        },
      ],
      agentState,
      profile: null,
      result:
        turn.status === 'resolved'
          ? {
              interactionId: input.interactionId,
              question: question.question,
              studentReply: reply,
              feedback: turn.message,
              result: turn.result ?? 'unclear',
            }
          : null,
      status: turn.status === 'resolved' ? 'completed' : 'waiting',
    });
  }
}

function relevantStudyHistory(
  history: AgentInboundTurnInput['history'],
  question: string,
): AgentInboundTurnInput['history'] {
  const questionIndex = history.findIndex(
    (entry) => entry.direction === 'outbound' && entry.text === question,
  );
  return questionIndex < 0 ? [] : history.slice(questionIndex);
}

function questionFrom(
  exercise?: VerifiedExerciseContext | null,
): GeneratedQuestion {
  if (!exercise) {
    return {
      question: CANONICAL_QUESTION,
      expectedAnswer: '4',
      rubric: 'A correct reply gives x = 4, however it is written.',
      meta: {
        agent: 'verified-source',
        promptVersion: VERIFIED_QUESTION_VERSION,
        model: null,
      },
    };
  }
  return {
    question: exercise.prompt,
    expectedAnswer: exercise.answerPayload.canonical,
    rubric: exercise.rubric,
    meta: {
      agent: 'verified-source',
      promptVersion: VERIFIED_QUESTION_VERSION,
      model: null,
    },
  };
}

function parseState(value: unknown): {
  step: string;
  hintsGiven: number;
  studentTurns: number;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Agent state is invalid');
  }
  const state = value as Record<string, unknown>;
  if (typeof state.step !== 'string') {
    throw new Error('Agent state step is invalid');
  }
  return {
    step: state.step,
    hintsGiven: nonNegativeInteger(state.hintsGiven),
    studentTurns: nonNegativeInteger(state.studentTurns),
  };
}

function nonNegativeInteger(value: unknown): number {
  if (value === undefined) return 0;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : 0;
}
