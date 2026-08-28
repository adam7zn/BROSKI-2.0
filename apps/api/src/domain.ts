import type {
  BackendToConversation,
  ConversationToBackend,
} from '@math-study-companion/contracts';

export type BackendContext = BackendToConversation;
export type ConversationResult = ConversationToBackend;

export interface StoredDemoInteraction {
  interactionId: string;
  traceId: string;
  context: BackendContext;
  result: ConversationResult | null;
  startedAt: string;
  completedAt: string | null;
}

export const canonicalBackendContext: BackendContext = {
  interactionId: 'demo-001',
  topic: 'linear equations',
  sourceText: 'Solve equations by applying the same operation to both sides.',
  difficulty: 'easy',
  image: null,
};
