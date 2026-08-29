import { z } from 'zod';

/**
 * The wire contract lives in `@math-study-companion/contracts`, which the API
 * validates against. This module re-exports it under the names the conversation
 * code uses, and adds the vocabulary that never crosses the boundary.
 */
export {
  backendToConversationSchema as backendContextSchema,
  conversationToBackendSchema as conversationResultSchema,
  interactionResultSchema,
  studyModeSchema,
  type InteractionResult,
  type BackendToConversation as BackendContext,
  type ConversationToBackend as ConversationResult,
  type StudyMode,
} from '@math-study-companion/contracts';

import { backendToConversationSchema } from '@math-study-companion/contracts';
import { conversationToBackendSchema } from '@math-study-companion/contracts';
import type { BackendToConversation } from '@math-study-companion/contracts';
import type { ConversationToBackend } from '@math-study-companion/contracts';

/** How hard the question should be. */
export const difficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof difficultySchema>;

/**
 * The wire contract types `difficulty` as a plain string, so anything can
 * arrive. Rather than let an unrecognised word quietly become the easiest
 * question, the agent reads it as medium — the setting that is wrong by the
 * least on either side.
 */
export function normaliseDifficulty(value: string): Difficulty {
  const parsed = difficultySchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : 'medium';
}

export function parseBackendContext(value: unknown): BackendToConversation {
  return backendToConversationSchema.parse(value);
}

export function parseConversationResult(value: unknown): ConversationToBackend {
  return conversationToBackendSchema.parse(value);
}
