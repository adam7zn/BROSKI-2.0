import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  backendToConversationSchema,
  type BackendToConversation,
} from '@math-study-companion/contracts';

export const studyItemSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  sourceText: z.string().min(1),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  image: z.string().url().nullable().default(null),
});
export type StudyItem = z.infer<typeof studyItemSchema>;

export const studyPlanSchema = z.array(studyItemSchema).min(1);

export function loadStudyPlan(path: string): StudyItem[] {
  return studyPlanSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export interface Selection {
  item: StudyItem;
  /** Plain-language reason, shown before anything is sent. */
  reason: string;
}

/**
 * Picks the next study item: anything never studied, then whatever was studied
 * longest ago.
 *
 * This is a scheduling rule, not a mastery model. It can be explained from the
 * record alone, which is what `docs/RULES.md` §2.7 asks for — a real review
 * interval based on performance evidence comes later.
 */
export function selectStudyItem(
  items: StudyItem[],
  lastUsed: Map<string, string>,
  now: Date = new Date(),
): Selection {
  const unused = items.find((item) => !lastUsed.has(item.id));
  if (unused) {
    return { item: unused, reason: 'never studied before' };
  }

  const sorted = [...items].sort(
    (a, b) => Date.parse(lastUsed.get(a.id)!) - Date.parse(lastUsed.get(b.id)!),
  );
  const item = sorted[0]!;
  const days = Math.floor(
    (now.getTime() - Date.parse(lastUsed.get(item.id)!)) / 86_400_000,
  );
  return {
    item,
    reason:
      days >= 1
        ? `last studied ${days} day${days === 1 ? '' : 's'} ago, the oldest in the plan`
        : 'the oldest in the plan, studied earlier today',
  };
}

/** Builds the context payload the conversation runtime consumes. */
export function toBackendContext(item: StudyItem): BackendToConversation {
  return backendToConversationSchema.parse({
    interactionId: randomUUID(),
    topic: item.topic,
    sourceText: item.sourceText,
    difficulty: item.difficulty,
    image: item.image,
  });
}
