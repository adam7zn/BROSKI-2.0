import {
  demoProfileInputSchema,
  type DemoProfileInput,
  type DemoSelfAssessedLevel,
} from '@math-study-companion/contracts';

import type { ReplyInbox } from './inbox.js';
import type { MessagingProvider } from './messaging/port.js';

const COURSE_PROMPT =
  "Hi, I'm Broski, your maths study companion. Which maths course are you taking?";
const LEVEL_PROMPT =
  'How is maths going right now: struggling, okay, or confident?';
const GRADE_PROMPT =
  "What grade did you receive last year? Reply SKIP if you'd rather not say.";
const CONFIRMATION =
  "Thanks — I've saved your setup. Here's one quick warm-up.";

export interface RunOnboardingInput {
  interactionId: string;
  conversationId: string;
  messaging: MessagingProvider;
  inbox: ReplyInbox;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * The judge demo's scripted three-question onboarding, in English.
 *
 * Deliberately left as its own path: the demo asserts these exact prompts. The
 * product flow is `runStudentSetup` in `./onboarding/student-setup.js`, which
 * asks what the planner actually needs.
 */
export async function runOnboarding(
  input: RunOnboardingInput,
): Promise<DemoProfileInput> {
  const course = await prompt(input, 'course', COURSE_PROMPT);
  const levelReply = await prompt(input, 'level', LEVEL_PROMPT);
  const gradeReply = await prompt(input, 'grade', GRADE_PROMPT);

  const profile = demoProfileInputSchema.parse({
    course: course.slice(0, 80),
    selfAssessedLevel: normalizeLevel(levelReply),
    previousGrade:
      gradeReply.trim().toUpperCase() === 'SKIP'
        ? null
        : gradeReply.trim().slice(0, 20),
  });

  await input.messaging.sendMessage({
    conversationId: input.conversationId,
    text: CONFIRMATION,
    idempotencyKey: `${input.interactionId}:onboarding:confirmation`,
  });
  return profile;
}

async function prompt(
  input: RunOnboardingInput,
  step: string,
  text: string,
): Promise<string> {
  const sent = await input.messaging.sendMessage({
    conversationId: input.conversationId,
    text,
    idempotencyKey: `${input.interactionId}:onboarding:${step}`,
  });
  const reply = await input.inbox.waitFor(input.conversationId, {
    notBefore: new Date(sent.acceptedAt),
    timeoutMs: input.timeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!reply) {
    if (input.signal?.aborted) throw new Error('Onboarding aborted');
    throw new Error(`Timed out waiting for onboarding step: ${step}`);
  }
  const value = reply.text.trim();
  if (!value) throw new Error(`Empty reply for onboarding step: ${step}`);
  return value;
}

function normalizeLevel(value: string): DemoSelfAssessedLevel {
  const normalized = value.toLowerCase();
  if (normalized.includes('struggl')) return 'struggling';
  if (normalized.includes('confident') || normalized.includes('good')) {
    return 'confident';
  }
  return 'okay';
}

export const judgeDemoMessages = {
  course: COURSE_PROMPT,
  level: LEVEL_PROMPT,
  grade: GRADE_PROMPT,
  confirmation: CONFIRMATION,
} as const;
