import type { BackendContext, InteractionResult } from '../contracts.js';

/**
 * What the agent produced before anything was sent.
 *
 * `docs/RULES.md` §3.8: a generated question must carry an expected answer or an
 * explicit rubric *before* delivery. Both are kept inside this package; only the
 * question text crosses the messaging boundary.
 */
export interface GeneratedQuestion {
  /** Exactly what the student will see. */
  question: string;
  /**
   * The answer a deterministic check can compare against, when the question has
   * one. `null` for questions that can only be judged by rubric.
   */
  expectedAnswer: string | null;
  /** How to judge a reply that is not a literal match. */
  rubric: string;
  /** Provenance for the trace (`docs/RULES.md` §3.3). */
  meta: AgentRunMeta;
}

export interface AgentRunMeta {
  agent: string;
  promptVersion: string;
  model: string | null;
}

export type TranscriptRole = 'companion' | 'student';

export interface TranscriptEntry {
  role: TranscriptRole;
  text: string;
  at: string;
}

/**
 * What the agent does with one student message.
 *
 * `hint` and `clarify` keep the conversation open — the student asked for help
 * or wrote something unreadable, and neither is an attempt to record. Only
 * `feedback` closes the interaction and produces a result.
 */
export interface AgentTurn {
  intent: 'hint' | 'clarify' | 'feedback';
  /** Exactly what the student will see next. */
  message: string;
  status: 'waiting' | 'resolved';
  /** Set when, and only when, `status` is `resolved`. */
  result: InteractionResult | null;
  /** 0–1. Below `MIN_CONFIDENCE` an answer must not become a verdict. */
  confidence: number;
  /** True when correctness came from a deterministic check, not the model. */
  deterministic: boolean;
  meta: AgentRunMeta;
}

export interface RespondInput {
  context: BackendContext;
  question: GeneratedQuestion;
  /** Everything said so far, oldest first, starting with the question. */
  transcript: TranscriptEntry[];
  /** How many hints have already been given, so they can escalate and stop. */
  hintsGiven: number;
  /** False on the last turn: the agent must resolve rather than ask again. */
  canContinue: boolean;
}

export interface FollowUpInput {
  context: BackendContext;
  question: GeneratedQuestion;
  transcript: TranscriptEntry[];
  message: string;
}

export interface FollowUpTurn {
  related: boolean;
  message: string;
  confidence: number;
  meta: AgentRunMeta;
}

/**
 * The study agent: one study item, as many turns as the student needs.
 */
export interface StudyAgent {
  askQuestion(context: BackendContext): Promise<GeneratedQuestion>;
  respond(input: RespondInput): Promise<AgentTurn>;
  followUp?(input: FollowUpInput): Promise<FollowUpTurn>;
  verifyProvider?(): Promise<{ provider: string; model: string | null }>;
}

/**
 * `docs/RULES.md` §3.7 — do not update learning state below the agreed
 * confidence threshold. Here that means: report `unclear` rather than a verdict.
 */
export const MIN_CONFIDENCE = 0.6;

/** Hints before the agent stops offering them and explains instead. */
export const MAX_HINTS = 2;

/** Student messages in one interaction before it is wrapped up regardless. */
export const MAX_STUDENT_TURNS = 6;
