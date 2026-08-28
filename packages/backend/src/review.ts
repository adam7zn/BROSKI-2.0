import type { InteractionResult } from '@msc/conversation';

/**
 * When a study item should come back.
 *
 * Deliberately a small, explainable rule rather than a mastery model: the
 * interval doubles while answers are right, holds when they are half right, and
 * collapses when they are wrong. `docs/RULES.md` §2.7 forbids claiming anything
 * that cannot be explained from stored evidence, and this can be read straight
 * off the attempt list.
 *
 * `unclear` changes nothing at all — an answer nobody could read is not
 * evidence about what the student knows (§2.4).
 */

export const FIRST_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 21;

export interface AttemptRecord {
  studyItemId: string;
  result: InteractionResult;
  at: string;
}

export interface ReviewState {
  studyItemId: string;
  /** Days until the next review after the last attempt. */
  intervalDays: number;
  dueAt: Date;
  lastAttemptAt: Date;
  lastResult: InteractionResult;
  /** How many times in a row he has been right. */
  streak: number;
}

export function reviewStateFor(attempts: AttemptRecord[]): ReviewState | null {
  const history = [...attempts].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  const last = history.at(-1);
  if (!last) return null;

  let intervalDays = FIRST_INTERVAL_DAYS;
  let streak = 0;

  for (const attempt of history) {
    switch (attempt.result) {
      case 'correct':
        streak += 1;
        intervalDays = Math.min(
          streak === 1 ? FIRST_INTERVAL_DAYS : intervalDays * 2,
          MAX_INTERVAL_DAYS,
        );
        break;
      case 'partially_correct':
        streak = 0;
        break;
      case 'incorrect':
        streak = 0;
        intervalDays = FIRST_INTERVAL_DAYS;
        break;
      case 'unclear':
        // No evidence either way; the schedule is untouched.
        break;
    }
  }

  const lastAttemptAt = new Date(last.at);
  return {
    studyItemId: last.studyItemId,
    intervalDays,
    dueAt: new Date(lastAttemptAt.getTime() + intervalDays * 86_400_000),
    lastAttemptAt,
    lastResult: last.result,
    streak,
  };
}

/** Groups a flat attempt list into one review state per study item. */
export function reviewStates(attempts: AttemptRecord[]): Map<string, ReviewState> {
  const byItem = new Map<string, AttemptRecord[]>();
  for (const attempt of attempts) {
    const bucket = byItem.get(attempt.studyItemId) ?? [];
    bucket.push(attempt);
    byItem.set(attempt.studyItemId, bucket);
  }

  const states = new Map<string, ReviewState>();
  for (const [itemId, itemAttempts] of byItem) {
    const state = reviewStateFor(itemAttempts);
    if (state) states.set(itemId, state);
  }
  return states;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
