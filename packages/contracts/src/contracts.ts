import { z } from 'zod';

const requiredString = z.string().min(1);

export const backendToConversationSchema = z
  .object({
    interactionId: requiredString,
    topic: requiredString,
    sourceText: requiredString,
    difficulty: requiredString,
    image: requiredString.nullable(),
  })
  .strict();

export type BackendToConversation = z.infer<typeof backendToConversationSchema>;

export const conversationToBackendSchema = z
  .object({
    interactionId: requiredString,
    question: requiredString,
    studentReply: requiredString,
    feedback: requiredString,
    result: requiredString,
  })
  .strict();

export type ConversationToBackend = z.infer<typeof conversationToBackendSchema>;
