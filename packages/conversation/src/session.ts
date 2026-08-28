import type { EvaluatedReply, GeneratedQuestion, StudyAgent } from './agent/types.js';
import type { BackendContext, ConversationResult } from './contracts.js';
import { conversationResultSchema } from './contracts.js';
import type { ReplyInbox } from './inbox.js';
import type { InboundMessageEvent, MessagingProvider } from './messaging/port.js';

export const DEFAULT_REPLY_TIMEOUT_MS = 30 * 60 * 1000;

export interface InteractionTrace {
  interactionId: string;
  conversationId: string;
  provider: string;
  questionSentAt: string;
  questionMessageId: string;
  repliedAt: string | null;
  feedbackMessageId: string | null;
  agent: string;
  model: string | null;
  questionPromptVersion: string;
  evaluationPromptVersion: string | null;
  confidence: number | null;
  deterministic: boolean | null;
}

export type InteractionOutcome =
  | {
      status: 'completed';
      context: BackendContext;
      question: GeneratedQuestion;
      reply: InboundMessageEvent;
      evaluation: EvaluatedReply;
      result: ConversationResult;
      trace: InteractionTrace;
    }
  | {
      status: 'no_reply';
      context: BackendContext;
      question: GeneratedQuestion;
      trace: InteractionTrace;
    };

export interface RunInteractionInput {
  context: BackendContext;
  conversationId: string;
  agent: StudyAgent;
  messaging: MessagingProvider;
  inbox: ReplyInbox;
  replyTimeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * One interaction, start to finish: ask, wait, judge, answer.
 *
 * Deliberately one question and one reply — no follow-up turn, no second
 * chance, no tools (`docs/PHASES.md` Phase 1). The caller persists the outcome;
 * this function owns no storage.
 */
export async function runInteraction(
  input: RunInteractionInput,
): Promise<InteractionOutcome> {
  const { context, conversationId, agent, messaging, inbox } = input;

  const question = await agent.askQuestion(context);

  // The image is forwarded, never generated here: the backend owns visuals.
  const sent = context.image
    ? await messaging.sendImage({
        conversationId,
        mediaUrl: context.image,
        altText: context.topic,
        caption: question.question,
        idempotencyKey: `${context.interactionId}:question`,
      })
    : await messaging.sendMessage({
        conversationId,
        text: question.question,
        idempotencyKey: `${context.interactionId}:question`,
      });

  const questionSentAt = new Date(sent.acceptedAt);
  const trace: InteractionTrace = {
    interactionId: context.interactionId,
    conversationId,
    provider: messaging.name,
    questionSentAt: sent.acceptedAt,
    questionMessageId: sent.providerMessageId,
    repliedAt: null,
    feedbackMessageId: null,
    agent: question.meta.agent,
    model: question.meta.model,
    questionPromptVersion: question.meta.promptVersion,
    evaluationPromptVersion: null,
    confidence: null,
    deterministic: null,
  };

  const waitOptions: {
    notBefore: Date;
    timeoutMs: number;
    signal?: AbortSignal;
  } = {
    notBefore: questionSentAt,
    timeoutMs: input.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS,
  };
  if (input.signal) waitOptions.signal = input.signal;

  const reply = await inbox.waitFor(conversationId, waitOptions);
  if (!reply) {
    // Silence is an answer of its own. Nothing is stored as an attempt, and
    // nothing is re-sent (docs/RULES.md §4.8).
    return { status: 'no_reply', context, question, trace };
  }

  const evaluation = await agent.evaluate({
    context,
    question,
    studentReply: reply.text,
  });

  const feedback = await messaging.sendMessage({
    conversationId,
    text: evaluation.feedback,
    idempotencyKey: `${context.interactionId}:feedback`,
  });

  const result = conversationResultSchema.parse({
    interactionId: context.interactionId,
    question: question.question,
    studentReply: reply.text,
    feedback: evaluation.feedback,
    result: evaluation.result,
  } satisfies ConversationResult);

  return {
    status: 'completed',
    context,
    question,
    reply,
    evaluation,
    result,
    trace: {
      ...trace,
      repliedAt: reply.receivedAt,
      feedbackMessageId: feedback.providerMessageId,
      evaluationPromptVersion: evaluation.meta.promptVersion,
      confidence: evaluation.confidence,
      deterministic: evaluation.deterministic,
    },
  };
}
