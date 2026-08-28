import { z } from 'zod';

/**
 * The two Phase 0 boundary payloads, as runtime schemas.
 *
 * `docs/RULES.md` §6.1 requires shared payloads to be validated at runtime, not
 * only typed. Everything crossing the Person A / Person B boundary is parsed
 * through these schemas — inbound and outbound.
 */

export const difficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof difficultySchema>;

/**
 * Why this interaction is happening, from ADR-003's mode list. It changes what
 * the agent asks: prime an idea, test a fresh one, or retrieve an old one.
 */
export const studyModeSchema = z.enum(['PREPARE', 'PRACTISE', 'REVIEW']);
export type StudyMode = z.infer<typeof studyModeSchema>;

/** Backend → conversation. Produced by Person B. */
export const backendContextSchema = z.object({
  interactionId: z.string().min(1),
  topic: z.string().min(1),
  sourceText: z.string().min(1),
  difficulty: difficultySchema,
  image: z.string().url().nullable(),
  // Added after Phase 0, with defaults, so the original fixture stays valid.
  mode: studyModeSchema.default('PRACTISE'),
  /** Plain-language explanation of why now — shown before anything is sent. */
  reason: z.string().default(''),
});
export type BackendContext = z.infer<typeof backendContextSchema>;

/**
 * Outcome of one interaction.
 *
 * `unclear` means the evaluator could not tell what the student meant. It is
 * not a wrong answer and must not be stored as one (`docs/RULES.md` §2.8).
 */
export const interactionResultSchema = z.enum([
  'correct',
  'partially_correct',
  'incorrect',
  'unclear',
]);
export type InteractionResult = z.infer<typeof interactionResultSchema>;

/** Conversation → backend. Produced by Person A. */
export const conversationResultSchema = z.object({
  interactionId: z.string().min(1),
  question: z.string().min(1),
  studentReply: z.string(),
  feedback: z.string().min(1),
  result: interactionResultSchema,
});
export type ConversationResult = z.infer<typeof conversationResultSchema>;

export function parseBackendContext(value: unknown): BackendContext {
  return backendContextSchema.parse(value);
}

export function parseConversationResult(value: unknown): ConversationResult {
  return conversationResultSchema.parse(value);
}
