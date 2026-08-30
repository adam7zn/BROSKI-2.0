import type {
  BackendToConversation,
  ConversationToBackend,
  DemoMessageEventInput,
  DemoProfileInput,
} from '@math-study-companion/contracts';

export type BackendContext = BackendToConversation;
export type ConversationResult = ConversationToBackend;

export interface StoredDemoInteraction {
  interactionId: string;
  exerciseId: string | null;
  traceId: string;
  context: BackendContext;
  result: ConversationResult | null;
  startedAt: string;
  completedAt: string | null;
}

export interface StoredDemoProfile extends DemoProfileInput {
  profileId: 'demo-student';
  traceId: string;
  completedAt: string;
}

export interface StoredDemoMessageEvent extends DemoMessageEventInput {
  id: string;
  interactionId: string;
  traceId: string;
  recordedAt: string;
}

export const canonicalBackendContext: BackendContext = {
  interactionId: 'demo-001',
  topic: 'linear equations',
  sourceText: 'Solve equations by applying the same operation to both sides.',
  difficulty: 'easy',
  image: null,
  mode: 'PRACTISE',
  reason: 'Manual judge MVP demonstration',
};
