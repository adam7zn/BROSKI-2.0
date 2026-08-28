import {
  ClaudeStudyAgent,
  ScriptedStudyAgent,
  type StudyAgent,
} from '@msc/conversation';
import {
  InteractionStore,
  loadStudyPlan,
  selectStudyItem,
  toBackendContext,
  type StudyItem,
} from '@msc/backend';
import type { BackendContext } from '@msc/conversation';

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
  context: BackendContext;
  item: StudyItem;
  reason: string;
}

/** Chooses what to study now and records it before anything is sent. */
export function planNextInteraction(
  store: InteractionStore,
  config: Config,
  conversationId: string,
): PlannedInteraction {
  const plan = loadStudyPlan(config.studyPlanPath);
  const { item, reason } = selectStudyItem(plan, store.lastUsedByStudyItem());
  const context = toBackendContext(item);
  store.planInteraction(context, conversationId, item.id);
  return { context, item, reason };
}

export function openStore(config: Config): InteractionStore {
  return new InteractionStore(config.databasePath);
}
