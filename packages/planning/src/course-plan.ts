import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * The course timeline: which lesson happens when, and which study items it
 * covers. This is what makes the companion timeline-aware rather than a
 * question generator — ADR-002.
 */

export const lessonSchema = z.object({
  id: z.string().min(1),
  /** Local date and time in the course timezone, e.g. "2026-09-01 09:15". */
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
  topic: z.string().min(1),
  /** Study items this lesson teaches. */
  covers: z.array(z.string()).default([]),
  /**
   * Study items worth meeting *before* the lesson: the prerequisites that make
   * it land. Falls back to `covers` when empty.
   */
  prepares: z.array(z.string()).default([]),
});
export type Lesson = z.infer<typeof lessonSchema>;

export const coursePlanSchema = z.object({
  courseName: z.string().min(1),
  /** IANA zone; the pilot runs in Europe/Stockholm (docs/RULES.md §5.6). */
  timezone: z.string().min(1).default('Europe/Stockholm'),
  lessons: z.array(lessonSchema),
});
export type CoursePlan = z.infer<typeof coursePlanSchema>;

export function loadCoursePlan(path: string): CoursePlan {
  return coursePlanSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Turns a local wall-clock string into an instant, using the course timezone.
 *
 * Sweden shifts between +01:00 and +02:00, so the offset has to be looked up
 * for that particular date rather than assumed.
 */
export function lessonStart(lesson: Lesson, timezone: string): Date {
  const [datePart, timePart] = lesson.startsAt.split(' ') as [string, string];
  const naive = new Date(`${datePart}T${timePart}:00Z`);
  const offsetMinutes = zoneOffsetMinutes(naive, timezone);
  return new Date(naive.getTime() - offsetMinutes * 60_000);
}

/** Minutes that `timezone` is ahead of UTC at the given instant. */
export function zoneOffsetMinutes(at: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']) === 24 ? 0 : Number(parts['hour']),
    Number(parts['minute']),
    Number(parts['second']),
  );
  return (asUtc - at.getTime()) / 60_000;
}

export interface LessonWindow {
  lesson: Lesson;
  startsAt: Date;
  hoursAway: number;
}

/** The next lesson that has not started yet. */
export function nextLesson(plan: CoursePlan, now: Date): LessonWindow | null {
  const upcoming = plan.lessons
    .map((lesson) => ({
      lesson,
      startsAt: lessonStart(lesson, plan.timezone),
    }))
    .filter((entry) => entry.startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

  if (!upcoming) return null;
  return {
    ...upcoming,
    hoursAway: (upcoming.startsAt.getTime() - now.getTime()) / 3_600_000,
  };
}

/** The most recent lesson that has already started. */
export function lastLesson(plan: CoursePlan, now: Date): LessonWindow | null {
  const past = plan.lessons
    .map((lesson) => ({
      lesson,
      startsAt: lessonStart(lesson, plan.timezone),
    }))
    .filter((entry) => entry.startsAt.getTime() <= now.getTime())
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];

  if (!past) return null;
  return {
    ...past,
    hoursAway: (now.getTime() - past.startsAt.getTime()) / 3_600_000,
  };
}
