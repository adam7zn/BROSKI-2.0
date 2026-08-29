import {
  lastLesson,
  nextLesson,
  type CoursePlan,
  type LessonWindow,
} from './course-plan.js';
import { daysBetween, type ReviewState } from './review.js';
import type { StudyItem } from './study-plan.js';

/**
 * Chooses what is worth doing now, from the date and the record.
 *
 * The modes are ADR-003's, minus the ones that need a learning model the pilot
 * does not have yet: prime the next lesson, practise the last one, retrieve
 * something due — or say nothing. Every branch produces a sentence explaining
 * itself, because `docs/PHASES.md` Phase 5 requires a visible reason before a
 * message may ever be sent on a schedule.
 */
export type StudyMode = 'PREPARE' | 'PRACTISE' | 'REVIEW';

export interface PlanDecision {
  mode: StudyMode | 'NO_ACTION';
  item: StudyItem | null;
  reason: string;
  lessonId: string | null;
}

export interface PlanInput {
  now: Date;
  plan: CoursePlan;
  items: StudyItem[];
  reviews: Map<string, ReviewState>;
  prepareWindowHours?: number;
  practiseWindowHours?: number;
}

export const DEFAULT_PREPARE_WINDOW_HOURS = 24;
export const DEFAULT_PRACTISE_WINDOW_HOURS = 48;

export function planStudySession(input: PlanInput): PlanDecision {
  const {
    now,
    plan,
    items,
    reviews,
    prepareWindowHours = DEFAULT_PREPARE_WINDOW_HOURS,
    practiseWindowHours = DEFAULT_PRACTISE_WINDOW_HOURS,
  } = input;

  const byId = new Map(items.map((item) => [item.id, item]));
  const upcoming = nextLesson(plan, now);
  const previous = lastLesson(plan, now);

  // 1. A lesson is close: meet the prerequisite before sitting in it.
  if (upcoming && upcoming.hoursAway <= prepareWindowHours) {
    const wanted = upcoming.lesson.prepares.length
      ? upcoming.lesson.prepares
      : upcoming.lesson.covers;
    const item = weakestFirst(resolve(wanted, byId), reviews)[0];
    if (item) {
      return {
        mode: 'PREPARE',
        item,
        lessonId: upcoming.lesson.id,
        reason: `"${upcoming.lesson.topic}" starts in ${describeDuration(upcoming.hoursAway)}, and this is what it builds on`,
      };
    }
  }

  // 2. A lesson just happened: find out whether the central idea stuck.
  if (previous && previous.hoursAway <= practiseWindowHours) {
    const item = weakestFirst(
      resolve(previous.lesson.covers, byId),
      reviews,
    )[0];
    if (item) {
      return {
        mode: 'PRACTISE',
        item,
        lessonId: previous.lesson.id,
        reason: `"${previous.lesson.topic}" was ${describeDuration(previous.hoursAway)} ago`,
      };
    }
  }

  // 3. Otherwise retrieve whatever the record says is due, most overdue first.
  const due = items
    .map((item) => ({ item, state: reviews.get(item.id) ?? null }))
    .filter(
      ({ state }) => state === null || state.dueAt.getTime() <= now.getTime(),
    )
    .sort((a, b) => dueRank(a.state, now) - dueRank(b.state, now));

  const first = due[0];
  if (first) {
    return {
      mode: 'REVIEW',
      item: first.item,
      lessonId: null,
      reason: first.state ? describeDue(first.state, now) : 'not studied yet',
    };
  }

  // 4. Nothing is worth interrupting for. Silence is a real decision
  //    (docs/RULES.md §1.3).
  return {
    mode: 'NO_ACTION',
    item: null,
    lessonId: null,
    reason: describeQuiet(reviews, now, upcoming),
  };
}

function resolve(ids: string[], byId: Map<string, StudyItem>): StudyItem[] {
  return ids
    .map((id) => byId.get(id))
    .filter((item): item is StudyItem => item !== undefined);
}

/** Never attempted first, then whatever went worst last time. */
function weakestFirst(
  items: StudyItem[],
  reviews: Map<string, ReviewState>,
): StudyItem[] {
  const rank = (item: StudyItem): number => {
    const state = reviews.get(item.id);
    if (!state) return 0;
    switch (state.lastResult) {
      case 'incorrect':
        return 1;
      case 'partially_correct':
        return 2;
      case 'unclear':
        return 3;
      case 'correct':
        return 4;
    }
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** More overdue sorts first; never-attempted items sort first of all. */
function dueRank(state: ReviewState | null, now: Date): number {
  if (!state) return Number.NEGATIVE_INFINITY;
  return state.dueAt.getTime() - now.getTime();
}

function describeDue(state: ReviewState, now: Date): string {
  const overdue = daysBetween(state.dueAt, now);
  const since = daysBetween(state.lastAttemptAt, now);
  const last =
    state.lastResult === 'correct'
      ? `answered correctly ${describeDays(since)} ago`
      : `went badly ${describeDays(since)} ago`;
  return overdue >= 1
    ? `${last}, and due for review ${describeDays(overdue)} ago`
    : `${last}, and due for review today`;
}

function describeQuiet(
  reviews: Map<string, ReviewState>,
  now: Date,
  upcoming: LessonWindow | null,
): string {
  const soonest = [...reviews.values()].sort(
    (a, b) => a.dueAt.getTime() - b.dueAt.getTime(),
  )[0];
  const parts = ['nothing is due'];
  if (soonest) {
    parts.push(
      `next review in ${describeDays(daysBetween(now, soonest.dueAt))}`,
    );
  }
  if (upcoming) {
    parts.push(`next lesson ${describeDuration(upcoming.hoursAway)} away`);
  }
  return parts.join('; ');
}

/** A bare span of time, so callers can put "in" or "ago" around it. */
function describeDuration(hours: number): string {
  const rounded = Math.round(hours);
  if (rounded < 1) return 'under an hour';
  if (rounded === 1) return 'an hour';
  if (rounded < 24) return `${rounded} hours`;
  return describeDays(Math.round(hours / 24));
}

function describeDays(days: number): string {
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}
