import {
  conversationAgentOutputSchema,
  demoProfileInputSchema,
  type BackendToConversation,
  type ConversationAgentOutput,
  type DemoProfileInput,
} from '@math-study-companion/contracts';

import { checkCanonicalAnswer } from './answer-check.js';
import { CANONICAL_FEEDBACK, CANONICAL_QUESTION } from './canonical-session.js';

export interface ConversationHistoryItem {
  direction: 'inbound' | 'outbound';
  text: string;
  occurredAt: string;
}

export interface AgentSessionStartInput {
  context: BackendToConversation;
  profile?: DemoProfileInput | null;
  traceId: string;
}

export interface AgentInboundTurnInput {
  interactionId: string;
  context: BackendToConversation;
  text: string;
  receivedAt: string;
  history: ConversationHistoryItem[];
  agentState: unknown;
  traceId: string;
}

export interface ConversationAgent {
  startSession(input: AgentSessionStartInput): Promise<ConversationAgentOutput>;
  handleInbound(input: AgentInboundTurnInput): Promise<ConversationAgentOutput>;
}

type DemoStep = 'course' | 'level' | 'grade' | 'answer' | 'complete';

type DemoAgentState = {
  step: DemoStep;
  course?: string;
  level?: DemoProfileInput['selfAssessedLevel'];
};

const COURSE_PROMPT =
  "Hi, I'm Broski, your maths study companion. Which maths course are you taking?";
const LEVEL_PROMPT =
  'How is maths going right now: struggling, okay, or confident?';
const GRADE_PROMPT =
  "What grade did you receive last year? Reply SKIP if you'd rather not say.";
const CONFIRMATION =
  "Thanks — I've saved your setup. Here's one quick warm-up.";

export class DeterministicDemoAgent implements ConversationAgent {
  async startSession(
    input: AgentSessionStartInput,
  ): Promise<ConversationAgentOutput> {
    if (input.profile) {
      return output({
        outbound: [textIntent('question', CANONICAL_QUESTION)],
        agentState: { step: 'answer' },
        profile: null,
        result: null,
        status: 'waiting',
      });
    }
    return output({
      outbound: [textIntent('onboarding-course', COURSE_PROMPT)],
      agentState: { step: 'course' },
      profile: null,
      result: null,
      status: 'waiting',
    });
  }

  async handleInbound(
    input: AgentInboundTurnInput,
  ): Promise<ConversationAgentOutput> {
    const state = parseState(input.agentState);
    const reply = input.text.trim();
    if (!reply) throw new Error('Agent received an empty inbound message');

    if (state.step === 'course') {
      return output({
        outbound: [textIntent('onboarding-level', LEVEL_PROMPT)],
        agentState: { step: 'level', course: reply },
        profile: null,
        result: null,
        status: 'waiting',
      });
    }

    if (state.step === 'level') {
      const level = normalizeLevel(reply);
      if (!level) {
        return output({
          outbound: [
            textIntent(
              'onboarding-level-retry',
              'Please reply struggling, okay, or confident.',
            ),
          ],
          agentState: state,
          profile: null,
          result: null,
          status: 'waiting',
        });
      }
      return output({
        outbound: [textIntent('onboarding-grade', GRADE_PROMPT)],
        agentState: {
          step: 'grade',
          ...(state.course === undefined ? {} : { course: state.course }),
          level,
        } satisfies DemoAgentState,
        profile: null,
        result: null,
        status: 'waiting',
      });
    }

    if (state.step === 'grade') {
      const profile = demoProfileInputSchema.parse({
        course: state.course,
        selfAssessedLevel: state.level,
        previousGrade: reply.toUpperCase() === 'SKIP' ? null : reply,
      });
      return output({
        outbound: [
          textIntent('onboarding-confirmation', CONFIRMATION),
          textIntent('question', CANONICAL_QUESTION),
        ],
        agentState: { step: 'answer' },
        profile,
        result: null,
        status: 'waiting',
      });
    }

    if (state.step === 'answer') {
      const verdict = checkCanonicalAnswer(reply);
      const feedback =
        verdict === 'correct'
          ? CANONICAL_FEEDBACK
          : verdict === 'incorrect'
            ? 'Not quite — subtract 3 first, then divide both sides by 2.'
            : "I couldn't read that as a value for x, so I've marked it unclear.";
      return output({
        outbound: [textIntent('feedback', feedback)],
        agentState: { step: 'complete' },
        profile: null,
        result: {
          interactionId: input.interactionId,
          question: CANONICAL_QUESTION,
          studentReply: reply,
          feedback,
          result: verdict,
        },
        status: 'completed',
      });
    }

    return output({
      outbound: [],
      agentState: state,
      profile: null,
      result: null,
      status: 'completed',
    });
  }
}

function textIntent(purpose: string, text: string) {
  return { purpose, text, mediaUrl: null };
}

function output(value: ConversationAgentOutput): ConversationAgentOutput {
  return conversationAgentOutputSchema.parse(value);
}

function normalizeLevel(
  value: string,
): DemoProfileInput['selfAssessedLevel'] | null {
  const normalized = value.toLowerCase();
  return normalized === 'struggling' ||
    normalized === 'okay' ||
    normalized === 'confident'
    ? normalized
    : null;
}

function parseState(value: unknown): DemoAgentState {
  if (!isRecord(value) || typeof value.step !== 'string') {
    throw new Error('Agent state is invalid');
  }
  if (
    !['course', 'level', 'grade', 'answer', 'complete'].includes(value.step)
  ) {
    throw new Error('Agent state step is invalid');
  }
  return {
    step: value.step as DemoStep,
    ...(typeof value.course === 'string' ? { course: value.course } : {}),
    ...(value.level === 'struggling' ||
    value.level === 'okay' ||
    value.level === 'confident'
      ? { level: value.level }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
