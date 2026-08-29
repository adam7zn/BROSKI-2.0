import {
  conversationToBackendSchema,
  type BackendToConversation,
  type ConversationToBackend,
} from '@math-study-companion/contracts';

import { checkCanonicalAnswer } from './answer-check.js';
import type { ReplyInbox } from './inbox.js';
import type { MessagingProvider } from './messaging/port.js';

export const CANONICAL_QUESTION = 'Solve 2x + 3 = 11.';
export const CANONICAL_FEEDBACK = 'Correct — subtract 3, then divide by 2.';

export interface RunCanonicalInteractionInput {
  context: BackendToConversation;
  conversationId: string;
  messaging: MessagingProvider;
  inbox: ReplyInbox;
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function runCanonicalInteraction(
  input: RunCanonicalInteractionInput,
): Promise<ConversationToBackend> {
  const sent = input.context.image
    ? await input.messaging.sendImage({
        conversationId: input.conversationId,
        mediaPath: input.context.image,
        altText: input.context.topic,
        caption: CANONICAL_QUESTION,
        idempotencyKey: `${input.context.interactionId}:question`,
      })
    : await input.messaging.sendMessage({
        conversationId: input.conversationId,
        text: CANONICAL_QUESTION,
        idempotencyKey: `${input.context.interactionId}:question`,
      });
  const reply = await input.inbox.waitFor(input.conversationId, {
    notBefore: new Date(sent.acceptedAt),
    timeoutMs: input.timeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!reply) {
    if (input.signal?.aborted) {
      throw new Error('Canonical interaction aborted');
    }
    throw new Error('Timed out waiting for the canonical answer');
  }

  const verdict = checkCanonicalAnswer(reply.text);
  const feedback =
    verdict === 'correct'
      ? CANONICAL_FEEDBACK
      : verdict === 'incorrect'
        ? 'Not quite — subtract 3 first, then divide both sides by 2.'
        : "I couldn't read that as a value for x, so I've marked it unclear.";

  await input.messaging.sendMessage({
    conversationId: input.conversationId,
    text: feedback,
    idempotencyKey: `${input.context.interactionId}:feedback`,
  });

  return conversationToBackendSchema.parse({
    interactionId: input.context.interactionId,
    question: CANONICAL_QUESTION,
    studentReply: reply.text,
    feedback,
    result: verdict,
  });
}
