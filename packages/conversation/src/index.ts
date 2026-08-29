export { checkCanonicalAnswer, type AnswerVerdict } from './answer-check.js';
export {
  CANONICAL_FEEDBACK,
  CANONICAL_QUESTION,
  runCanonicalInteraction,
  type RunCanonicalInteractionInput,
} from './canonical-session.js';
export {
  judgeDemoMessages,
  runOnboarding,
  type RunOnboardingInput,
} from './onboarding.js';

export * from './contracts.js';
export * from './onboarding/parse.js';
export * from './onboarding/steps.js';
export * from './onboarding/student-setup.js';
export * from './onboarding/smart-setup.js';
export * from './agent/model-call.js';
export * from './tutor/retrieval.js';
export * from './tutor/tutor.js';
export * from './inbox.js';
export * from './session.js';
export * from './agent/types.js';
export * from './agent/answer-check.js';
export * from './agent/claude-agent.js';
export * from './agent/document-reader.js';
export * from './agent/scripted-document-reader.js';
export * from './agent/scripted-agent.js';
export * from './messaging/port.js';
export * from './messaging/fake.js';
export * from './messaging/telegram.js';
export {
  ExecFileCommandRunner,
  IMessageCliProvider,
  type CommandResult,
  type IMessageCliOptions,
  type IMessageCommandRunner,
} from './messaging/imessage-cli.js';
