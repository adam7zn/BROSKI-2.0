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
import { checkAnswer } from './agent/answer-check.js';
import { checkCanonicalAnswer } from './answer-check.js';
import { CANONICAL_FEEDBACK, CANONICAL_QUESTION } from './canonical-session.js';

const VERIFIED_QUESTION_VERSION = 'verified-source/2026-08-30.1';
const SCREEN_RECORDING_MODE = 'screen-recording-v1';
const SCREEN_RECORDING_INTRO =
  "For this demo, let's use the time between maths and football for two quick questions based on earlier mistakes.";
const SCREEN_RECORDING_FINISHED =
  'That finishes the two-question demo. Nice work.';

type ScreenRecordingStage =
  'onboarding' | 'first-answer' | 'await-next' | 'second-answer' | 'done';

export interface ClaudeConversationAgentOptions {
  studyAgent?: StudyAgent;
  screenRecordingDemo?: boolean;
}

/**
 * Adapts the richer model-backed StudyAgent to the durable hosted boundary.
 * Onboarding and transport remain deterministic; Claude sees only the one
 * verified exercise and the relevant conversation transcript.
 */
export class ClaudeConversationAgent implements ConversationAgent {
  readonly #onboarding = new DeterministicDemoAgent();
  readonly #studyAgent: StudyAgent;
  readonly #screenRecordingDemo: boolean;

  constructor(options: ClaudeConversationAgentOptions = {}) {
    this.#studyAgent = options.studyAgent ?? new ClaudeStudyAgent();
    this.#screenRecordingDemo = options.screenRecordingDemo ?? false;
  }

  verifyProvider(): Promise<{ provider: string; model: string | null }> {
    if (!this.#studyAgent.verifyProvider) {
      throw new Error('The selected study agent cannot verify its provider');
    }
    return this.#studyAgent.verifyProvider();
  }

  async startSession(
    input: AgentSessionStartInput,
  ): Promise<ConversationAgentOutput> {
    const started = await this.#onboarding.startSession(input);
    if (!this.#screenRecordingDemo || !input.exercise) return started;

    const step = stateStep(started.agentState);
    return recordingOutput(started, {
      stage: step === 'answer' ? 'first-answer' : 'onboarding',
      addIntro: step === 'answer',
    });
  }

  async handleInbound(
    input: AgentInboundTurnInput,
  ): Promise<ConversationAgentOutput> {
    const state = parseState(input.agentState);
    if (state.step === 'complete') {
      if (state.screenRecordingStage === 'await-next') {
        const reply = input.text.trim();
        if (!reply) throw new Error('Agent received an empty inbound message');
        if (isNextQuestionRequest(reply)) {
          return conversationAgentOutputSchema.parse({
            outbound: [
              {
                purpose: 'screen-recording-question-2',
                text: CANONICAL_QUESTION,
                mediaUrl: null,
              },
            ],
            agentState: recordingState('second-answer'),
            profile: null,
            result: null,
            status: 'waiting',
          });
        }
      }

      if (state.screenRecordingStage === 'second-answer') {
        const reply = input.text.trim();
        if (!reply) throw new Error('Agent received an empty inbound message');
        const verdict = checkCanonicalAnswer(reply);
        const feedback =
          verdict === 'correct'
            ? `${CANONICAL_FEEDBACK} ${SCREEN_RECORDING_FINISHED}`
            : verdict === 'incorrect'
              ? `Not quite — subtract 3 first, then divide both sides by 2. The answer is x = 4. ${SCREEN_RECORDING_FINISHED}`
              : `I couldn't read that as a value for x. The verified answer is x = 4. ${SCREEN_RECORDING_FINISHED}`;
        return conversationAgentOutputSchema.parse({
          outbound: [
            {
              purpose: 'screen-recording-finished',
              text: feedback,
              mediaUrl: null,
            },
          ],
          agentState: recordingState('done'),
          profile: null,
          result: null,
          status: 'waiting',
        });
      }

      if (state.screenRecordingStage === 'done') {
        return conversationAgentOutputSchema.parse({
          outbound: [
            {
              purpose: 'screen-recording-finished',
              text: 'The two-question demo is complete.',
              mediaUrl: null,
            },
          ],
          agentState: recordingState('done'),
          profile: null,
          result: null,
          status: 'waiting',
        });
      }

      if (!this.#studyAgent.followUp) {
        throw new Error('The selected study agent does not support follow-ups');
      }
      const reply = input.text.trim();
      if (!reply) throw new Error('Agent received an empty inbound message');
      const question = questionFrom(input.exercise);
      const history = relevantStudyHistory(input.history, question.question);
      const transcript: TranscriptEntry[] = [
        ...history.slice(-12).map(
          (entry) =>
            ({
              role: entry.direction === 'outbound' ? 'companion' : 'student',
              text: entry.text,
              at: entry.occurredAt,
            }) satisfies TranscriptEntry,
        ),
        { role: 'student', text: reply, at: input.receivedAt },
      ];
      const followUp = await this.#studyAgent.followUp({
        context: input.context,
        question,
        transcript,
        message: reply,
      });
      const output = conversationAgentOutputSchema.parse({
        outbound: [
          {
            purpose: followUp.related ? 'follow-up' : 'follow-up-boundary',
            text: followUp.message,
            mediaUrl: null,
          },
        ],
        agentState: {
          step: 'complete',
          agent: followUp.meta.agent,
          model: followUp.meta.model ?? 'none',
          promptVersion: followUp.meta.promptVersion,
          confidence: String(followUp.confidence),
        },
        profile: null,
        result: null,
        status: 'waiting',
      });
      return state.screenRecordingStage === 'await-next'
        ? recordingOutput(output, { stage: 'await-next' })
        : output;
    }
    if (state.step !== 'answer') {
      const onboarding = await this.#onboarding.handleInbound(input);
      if (!state.screenRecordingStage || !input.exercise) return onboarding;
      const step = stateStep(onboarding.agentState);
      return recordingOutput(onboarding, {
        stage: step === 'answer' ? 'first-answer' : 'onboarding',
        addIntro: step === 'answer',
      });
    }

    const reply = input.text.trim();
    if (!reply) throw new Error('Agent received an empty inbound message');
    if (state.screenRecordingStage === 'first-answer' && input.exercise) {
      const verdict = verifiedNumericVerdict(input.exercise, reply);
      if (verdict !== 'unclear') {
        const feedback =
          verdict === 'correct'
            ? 'Correct — that matches the verified answer.'
            : `Not quite. ${input.exercise.solutionText}`;
        return conversationAgentOutputSchema.parse({
          outbound: [
            {
              purpose: 'feedback',
              text: feedback,
              mediaUrl: null,
            },
          ],
          agentState: recordingState('await-next'),
          profile: null,
          result: {
            interactionId: input.interactionId,
            question: input.exercise.prompt,
            studentReply: reply,
            feedback,
            result: verdict,
          },
          status: 'completed',
        });
      }
    }
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
      ...(state.screenRecordingStage
        ? {
            screenRecordingMode: SCREEN_RECORDING_MODE,
            screenRecordingStage:
              turn.status === 'resolved' ? 'await-next' : 'first-answer',
          }
        : {}),
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
  screenRecordingStage: ScreenRecordingStage | null;
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
    screenRecordingStage:
      state.screenRecordingMode === SCREEN_RECORDING_MODE
        ? parseScreenRecordingStage(state.screenRecordingStage)
        : null,
  };
}

function recordingOutput(
  output: ConversationAgentOutput,
  options: { stage: ScreenRecordingStage; addIntro?: boolean },
): ConversationAgentOutput {
  const outbound = options.addIntro
    ? [
        {
          purpose: 'screen-recording-intro',
          text: SCREEN_RECORDING_INTRO,
          mediaUrl: null,
        },
        ...output.outbound,
      ]
    : output.outbound;
  return conversationAgentOutputSchema.parse({
    ...output,
    outbound,
    agentState: {
      ...(isRecord(output.agentState) ? output.agentState : {}),
      screenRecordingMode: SCREEN_RECORDING_MODE,
      screenRecordingStage: options.stage,
    },
  });
}

function recordingState(stage: ScreenRecordingStage): Record<string, string> {
  return {
    step: 'complete',
    screenRecordingMode: SCREEN_RECORDING_MODE,
    screenRecordingStage: stage,
  };
}

function stateStep(value: unknown): string | null {
  return isRecord(value) && typeof value.step === 'string' ? value.step : null;
}

function parseScreenRecordingStage(
  value: unknown,
): ScreenRecordingStage | null {
  return value === 'onboarding' ||
    value === 'first-answer' ||
    value === 'await-next' ||
    value === 'second-answer' ||
    value === 'done'
    ? value
    : null;
}

function isNextQuestionRequest(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/u, '')
    .trim();
  return (
    normalized === 'next' ||
    normalized === 'next question' ||
    normalized === 'nästa' ||
    normalized === 'nästa fråga'
  );
}

function verifiedNumericVerdict(
  exercise: VerifiedExerciseContext,
  reply: string,
): 'correct' | 'incorrect' | 'unclear' {
  const accepted = [
    exercise.answerPayload.canonical,
    ...exercise.answerPayload.accepted,
  ];
  if (accepted.some((answer) => checkAnswer(answer, reply) === 'match')) {
    return 'correct';
  }
  return checkAnswer(exercise.answerPayload.canonical, reply) === 'mismatch'
    ? 'incorrect'
    : 'unclear';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number {
  if (value === undefined) return 0;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : 0;
}
