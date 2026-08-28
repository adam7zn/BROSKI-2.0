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

/** The agent's judgement of one reply. */
export interface EvaluatedReply {
  result: InteractionResult;
  /** Exactly what the student will see next. */
  feedback: string;
  /** 0–1. Below `MIN_CONFIDENCE` the result must be treated as `unclear`. */
  confidence: number;
  /** True when correctness came from a deterministic check, not the model. */
  deterministic: boolean;
  meta: AgentRunMeta;
}

export interface AgentRunMeta {
  agent: string;
  promptVersion: string;
  model: string | null;
}

export interface EvaluateInput {
  context: BackendContext;
  question: GeneratedQuestion;
  studentReply: string;
}

/**
 * The one simple agent of Phase 1: one question, one reply, one evaluation, one
 * feedback message. No tools, retrieval, memory, planning, or follow-up.
 */
export interface StudyAgent {
  askQuestion(context: BackendContext): Promise<GeneratedQuestion>;
  evaluate(input: EvaluateInput): Promise<EvaluatedReply>;
}

/**
 * `docs/RULES.md` §3.7 — do not update learning state below the agreed
 * confidence threshold. Here that means: report `unclear` rather than a verdict.
 */
export const MIN_CONFIDENCE = 0.6;
