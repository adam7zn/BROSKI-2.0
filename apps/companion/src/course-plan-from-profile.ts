import { writeFileSync } from 'node:fs';

import type {
  LessonSlot,
  StudentProfile,
} from '@math-study-companion/contracts';
import type { CoursePlan, Lesson } from '@math-study-companion/planning';

const WEEKDAY_INDEX: Record<LessonSlot['weekday'], number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Turns the weekly lesson slots the student gave into dated lessons.
 *
 * `covers` is left empty on purpose: which study item a given lesson teaches is
 * something only a person knows yet, and guessing would put invented course
 * facts into the timeline (`docs/RULES.md` §3.5). The dates are real; the
 * mapping is the next thing a human fills in.
 */
export function coursePlanFromProfile(
  profile: StudentProfile,
  options: { from?: Date; weeks?: number } = {},
): CoursePlan {
  const from = options.from ?? new Date();
  const weeks = options.weeks ?? 4;
  const lessons: Lesson[] = [];

  for (let week = 0; week < weeks; week += 1) {
    for (const slot of profile.lessonSlots) {
      const date = nextWeekday(from, WEEKDAY_INDEX[slot.weekday], week);
      lessons.push({
        id: `${slot.weekday}-${slot.startsAt.replace(':', '')}-w${week}`,
        startsAt: `${isoDate(date)} ${slot.startsAt}`,
        topic: profile.currentTopic ?? profile.course?.raw ?? 'Matematik',
        covers: [],
        prepares: [],
      });
    }
  }

  lessons.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    courseName: profile.course?.code ?? profile.course?.raw ?? 'Matematik',
    timezone: profile.timezone,
    lessons,
  };
}

export function writeCoursePlan(path: string, plan: CoursePlan): void {
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
}

/** The first date on or after `from` that falls on `weekday`, plus whole weeks. */
function nextWeekday(from: Date, weekday: number, weeksAhead: number): Date {
  const date = new Date(from);
  date.setHours(0, 0, 0, 0);
  const shift = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + shift + weeksAhead * 7);
  return date;
}

function isoDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
