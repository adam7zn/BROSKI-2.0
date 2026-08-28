import {
  MAX_STUDENT_TURNS,
  type AgentTurn,
  type GeneratedQuestion,
  type StudyAgent,
  type TranscriptEntry,
} from './agent/types.js';
import type { BackendContext, ConversationResult } from './contracts.js';
import { conversationResultSchema } from './contracts.js';
import type { ReplyInbox } from './inbox.js';
import type { InboundMessageEvent, MessagingProvider } from './messaging/port.js';

export const DEFAULT_REPLY_TIMEOUT_MS = 30 * 60 * 1000;
/** A follow-up comes faster than a first reply, or not at all. */
export const DEFAULT_FOLLOW_UP_TIMEOUT_MS = 10 * 60 * 1000;

export interface InteractionTrace {
  interactionId: string;
  conversationId: string;
  provider: string;
  mode: string;
  reason: string;
  questionSentAt: string;
  questionMessageId: string;
  repliedAt: string | null;
  studentTurns: number;
  hintsGiven: number;
  agent: string;
  model: string | null;
  questionPromptVersion: string;
  respondPromptVersion: string | null;
  confidence: number | null;
  deterministic: boolean | null;
}

export type InteractionOutcome =
  | {
      status: 'completed';
      context: BackendContext;
      question: GeneratedQuestion;
      transcript: TranscriptEntry[];
      final: AgentTurn;
      result: ConversationResult;
      trace: InteractionTrace;
    }
  | {
      status: 'no_reply';
      context: BackendContext;
      question: GeneratedQuestion;
      transcript: TranscriptEntry[];
      trace: InteractionTrace;
    };

export interface RunInteractionInput {
  context: BackendContext;
  conversationId: string;
  agent: StudyAgent;
  messaging: MessagingProvider;
  inbox: ReplyInbox;
  replyTimeoutMs?: number;
  followUpTimeoutMs?: number;
  maxStudentTurns?: number;
  signal?: AbortSignal;
  /** Called after each message, so a runner can show the conversation live. */
  onMessage?: (entry: TranscriptEntry) => void;
}

/**
 * One study item, start to finish, over as many turns as it takes.
 *
 * The student can answer, ask for a hint, say he is stuck, or write something
 * unreadable; only an actual judgement ends the interaction. Hints and
 * clarifications are conversation, not evidence — nothing is recorded as an
 * attempt until the agent resolves.
 */
export async function runInteraction(
  input: RunInteractionInput,
): Promise<InteractionOutcome> {
  const { context, conversationId, agent, messaging, inbox } = input;
  const maxStudentTurns = input.maxStudentTurns ?? MAX_STUDENT_TURNS;
  const transcript: TranscriptEntry[] = [];

  const record = (entry: TranscriptEntry): void => {
    transcript.push(entry);
    input.onMessage?.(entry);
  };

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

  record({ role: 'companion', text: question.question, at: sent.acceptedAt });

  const trace: InteractionTrace = {
    interactionId: context.interactionId,
    conversationId,
    provider: messaging.name,
    mode: context.mode,
    reason: context.reason,
    questionSentAt: sent.acceptedAt,
    questionMessageId: sent.providerMessageId,
    repliedAt: null,
    studentTurns: 0,
    hintsGiven: 0,
    agent: question.meta.agent,
    model: question.meta.model,
    questionPromptVersion: question.meta.promptVersion,
    respondPromptVersion: null,
    confidence: null,
    deterministic: null,
  };

  // Everything he sends after the question counts, in the order it arrived —
  // including a second message he fires off before our reply lands. The inbox
  // consumes each event once, so turns simply take the next unread one.
  const notBefore = new Date(sent.acceptedAt);
  let hintsGiven = 0;

  for (let studentTurn = 1; studentTurn <= maxStudentTurns; studentTurn += 1) {
    const reply = await waitForReply(input, notBefore, studentTurn === 1);
    if (!reply) {
      // Silence is an answer of its own. Nothing is stored as an attempt, and
      // nothing is re-sent (docs/RULES.md §4.8).
      return { status: 'no_reply', context, question, transcript, trace };
    }

    record({ role: 'student', text: reply.text, at: reply.receivedAt });
    trace.repliedAt ??= reply.receivedAt;
    trace.studentTurns = studentTurn;

    const turn = await agent.respond({
      context,
      question,
      transcript,
      hintsGiven,
      canContinue: studentTurn < maxStudentTurns,
    });

    const outbound = await messaging.sendMessage({
      conversationId,
      text: turn.message,
      // One key per turn: a resumed run repeats neither hint nor verdict.
      idempotencyKey: `${context.interactionId}:turn-${studentTurn}`,
    });
    record({ role: 'companion', text: turn.message, at: outbound.acceptedAt });

    trace.respondPromptVersion = turn.meta.promptVersion;

    if (turn.status === 'resolved') {
      trace.confidence = turn.confidence;
      trace.deterministic = turn.deterministic;
      trace.hintsGiven = hintsGiven;

      const result = conversationResultSchema.parse({
        interactionId: context.interactionId,
        question: question.question,
        studentReply: lastStudentText(transcript),
        feedback: turn.message,
        result: turn.result ?? 'unclear',
      } satisfies ConversationResult);

      return {
        status: 'completed',
        context,
        question,
        transcript,
        final: turn,
        result,
        trace,
      };
    }

    if (turn.intent === 'hint') hintsGiven += 1;
    trace.hintsGiven = hintsGiven;
  }

  // Unreachable: the last turn forces the agent to resolve.
  return { status: 'no_reply', context, question, transcript, trace };
}

function waitForReply(
  input: RunInteractionInput,
  notBefore: Date,
  isFirst: boolean,
): Promise<InboundMessageEvent | null> {
  const timeoutMs = isFirst
    ? (input.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS)
    : (input.followUpTimeoutMs ?? DEFAULT_FOLLOW_UP_TIMEOUT_MS);

  const options: { notBefore: Date; timeoutMs: number; signal?: AbortSignal } = {
    notBefore,
    timeoutMs,
  };
  if (input.signal) options.signal = input.signal;
  return input.inbox.waitFor(input.conversationId, options);
}

/** The result payload records what he actually answered, not a hint request. */
function lastStudentText(transcript: TranscriptEntry[]): string {
  return [...transcript].reverse().find((entry) => entry.role === 'student')?.text ?? '';
}
