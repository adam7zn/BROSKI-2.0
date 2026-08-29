import {
  ClaudeStudyAgent,
  ScriptedStudyAgent,
  backendContextSchema,
  type BackendContext,
  type StudyAgent,
} from '@math-study-companion/conversation';
import {
  loadCoursePlan,
  loadStudyPlan,
  planStudySession,
  reviewStates,
  type PlanDecision,
  type StudyItem,
} from '@math-study-companion/planning';
import { randomUUID } from 'node:crypto';

import { InteractionStore } from './local-store.js';
import type { Config } from './config.js';

export function buildAgent(config: Config): StudyAgent {
  if (!config.hasModelKey) {
    console.warn(
      'ANTHROPIC_API_KEY is not set — using the scripted fixture agent. ' +
        'Its questions are generated drills, not course material.',
    );
    return new ScriptedStudyAgent();
  }
  return new ClaudeStudyAgent();
}

export interface PlannedInteraction {
  decision: PlanDecision;
  /** Null when the decision was to stay quiet. */
  context: BackendContext | null;
  item: StudyItem | null;
}

/**
 * Decides what is worth doing now from the timeline and the record, and records
 * the interaction before anything is sent.
 */
export function planNextInteraction(
  store: InteractionStore,
  config: Config,
  conversationId: string,
  options: { now?: Date; force?: boolean } = {},
): PlannedInteraction {
  const now = options.now ?? new Date();
  const items = loadStudyPlan(config.studyPlanPath);
  const plan = loadCoursePlan(config.coursePlanPath);
  const reviews = reviewStates(store.attemptHistory());

  let decision = planStudySession({ now, plan, items, reviews });

  if (decision.mode === 'NO_ACTION' && options.force) {
    // Manual override for trying things out; the reason still says the truth.
    const fallback = items[0];
    if (fallback) {
      decision = {
        mode: 'REVIEW',
        item: fallback,
        lessonId: null,
        reason: `${decision.reason} — asked anyway because you started it by hand`,
      };
    }
  }

  if (decision.mode === 'NO_ACTION' || !decision.item) {
    return { decision, context: null, item: null };
  }

  const context = backendContextSchema.parse({
    interactionId: randomUUID(),
    topic: decision.item.topic,
    sourceText: decision.item.sourceText,
    difficulty: decision.item.difficulty,
    image: decision.item.image,
    mode: decision.mode,
    reason: decision.reason,
  });

  store.planInteraction(
    context,
    conversationId,
    decision.item.id,
    decision.lessonId,
  );
  return { decision, context, item: decision.item };
}

export function openStore(config: Config): InteractionStore {
  return new InteractionStore(config.databasePath);
}
