import type { ReplyInbox } from '../inbox.js';
import type { MessagingProvider } from '../messaging/port.js';

/**
 * One question in a setup conversation.
 *
 * A step owns its own reading of the answer, so nothing is stored that the
 * companion could not actually understand.
 */
export interface OnboardingStep<T> {
  id: string;
  prompt: string | ((answers: Record<string, unknown>) => string);
  /** May be skipped, by saying so or by an answer nobody can read. */
  optional: boolean;
  /**
   * `attempt` is 0 the first time and 1 after a retry, so a step can insist on
   * an answer it recognises once and then settle for what it was given.
   */
  parse: (reply: string, context: { today: Date; attempt: number }) => T | null;
  /** Said once when the answer could not be read, before asking again. */
  retryPrompt?: string;
}

export interface RunStepsInput {
  interactionId: string;
  /**
   * Shared by every step: replies count from when setup began, not from when
   * each question went out. A student who answers two questions in one burst,
   * or types while the companion is still composing, must not have the second
   * message thrown away — the inbox already hands out each event exactly once,
   * in arrival order.
   */
  anchor?: { at: Date | null };
  conversationId: string;
  messaging: MessagingProvider;
  inbox: ReplyInbox;
  timeoutMs: number;
  signal?: AbortSignal;
  today?: Date;
  onMessage?: (entry: { role: 'companion' | 'student'; text: string }) => void;
}

export class OnboardingAbandoned extends Error {
  constructor(readonly stepId: string) {
    super(`No reply during setup at step "${stepId}".`);
    this.name = 'OnboardingAbandoned';
  }
}

/**
 * Asks one step and reads the answer.
 *
 * A required step that cannot be read is asked exactly once more, then given
 * up on rather than pressed — `docs/RULES.md` §4.10 rules out badgering, and a
 * companion that will not move on is worse than one missing a field.
 */
export async function askStep<T>(
  input: RunStepsInput,
  step: OnboardingStep<T>,
  answers: Record<string, unknown>,
): Promise<T | null> {
  const today = input.today ?? new Date();
  const text =
    typeof step.prompt === 'function' ? step.prompt(answers) : step.prompt;

  for (const attempt of [0, 1]) {
    const message = attempt === 0 ? text : (step.retryPrompt ?? text);
    const reply = await exchange(input, `${step.id}-${attempt}`, message);
    const parsed = step.parse(reply, { today, attempt });
    if (parsed !== null) return parsed;
    if (step.optional) return null;
    if (attempt === 1) return null;
  }
  return null;
}

/** Sends one message and waits for the reply that follows it. */
async function exchange(
  input: RunStepsInput,
  key: string,
  text: string,
): Promise<string> {
  const sent = await input.messaging.sendMessage({
    conversationId: input.conversationId,
    text,
    idempotencyKey: `${input.interactionId}:setup:${key}`,
  });
  input.onMessage?.({ role: 'companion', text });

  const anchor = input.anchor ?? { at: null };
  anchor.at ??= new Date(sent.acceptedAt);

  const reply = await input.inbox.waitFor(input.conversationId, {
    notBefore: anchor.at,
    timeoutMs: input.timeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!reply) throw new OnboardingAbandoned(key);
  input.onMessage?.({ role: 'student', text: reply.text });
  return reply.text;
}

/** Sends a message that expects no answer. */
export async function say(
  input: RunStepsInput,
  key: string,
  text: string,
): Promise<void> {
  await input.messaging.sendMessage({
    conversationId: input.conversationId,
    text,
    idempotencyKey: `${input.interactionId}:setup:${key}`,
  });
  input.onMessage?.({ role: 'companion', text });
}
