import {
  runSmartSetup,
  runStudentSetup,
  type MessagingProvider,
  type ReplyInbox,
} from '@math-study-companion/conversation';
import type { StudentProfile } from '@math-study-companion/contracts';

import type { Config } from './config.js';
import {
  coursePlanFromProfile,
  writeCoursePlan,
} from './course-plan-from-profile.js';
import type { InteractionStore } from './local-store.js';

export interface SetupGateInput {
  store: InteractionStore;
  config: Config;
  conversationId: string;
  messaging: MessagingProvider;
  inbox: ReplyInbox;
  signal?: AbortSignal;
  onMessage?: (entry: { role: 'companion' | 'student'; text: string }) => void;
}

/**
 * Makes sure the companion knows who it is talking to before it asks anything.
 *
 * On the first contact this is the whole conversation: it introduces itself,
 * asks what to call him, and collects what the planner needs. Afterwards it is
 * a single lookup and costs nothing.
 */
export async function ensureProfile(
  input: SetupGateInput,
): Promise<StudentProfile> {
  const existing = input.store.loadProfile(input.conversationId);
  if (existing) return existing;

  // With a key the companion holds a real conversation; without one it falls
  // back to the fixed questionnaire, which needs no model at all.
  const runSetup = input.config.hasModelKey ? runSmartSetup : runStudentSetup;

  const profile = await runSetup({
    interactionId: `setup-${Date.now()}`,
    conversationId: input.conversationId,
    messaging: input.messaging,
    inbox: input.inbox,
    timeoutMs: input.config.replyTimeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onMessage ? { onMessage: input.onMessage } : {}),
  });

  input.store.saveProfile(input.conversationId, profile);

  // The lesson times he just gave are the course timeline; nothing else in the
  // system knows when his lessons are.
  if (profile.lessonSlots.length > 0) {
    writeCoursePlan(
      input.config.coursePlanPath,
      coursePlanFromProfile(profile),
    );
  }
  return profile;
}
