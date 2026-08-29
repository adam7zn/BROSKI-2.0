import { z } from 'zod';

/**
 * What the companion knows about the student before it asks anything.
 *
 * Collected once, in conversation, and then relied on: the course and textbook
 * decide what questions may be built from, the lesson slots become the course
 * timeline the planner reads, and the quiet hours bound when anything may be
 * sent at all.
 *
 * Everything except a name is optional. A student who will not say his age
 * still gets a working companion, and `docs/RULES.md` §5.8 keeps personal data
 * to what the feature actually needs.
 */

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const weekdaySchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);
export type Weekday = z.infer<typeof weekdaySchema>;

/** One recurring lesson in the school week. */
export const lessonSlotSchema = z
  .object({
    weekday: weekdaySchema,
    startsAt: time,
  })
  .strict();
export type LessonSlot = z.infer<typeof lessonSlotSchema>;

/**
 * The Swedish upper-secondary mathematics courses. The letter tracks the
 * programme: a for vocational, b for social science and arts, c for natural
 * science and technology.
 */
export const mathCourseCodeSchema = z.enum([
  'Ma1a',
  'Ma1b',
  'Ma1c',
  'Ma2a',
  'Ma2b',
  'Ma2c',
  'Ma3b',
  'Ma3c',
  'Ma4',
  'Ma5',
]);
export type MathCourseCode = z.infer<typeof mathCourseCodeSchema>;

/**
 * What the student called their course, and what that resolved to.
 *
 * `raw` is always kept: a course whose name did not match anything known is
 * still the truth about what they are studying, and inventing a code for it
 * would break `docs/RULES.md` §3.5.
 */
export const courseIdentitySchema = z
  .object({
    code: mathCourseCodeSchema.nullable(),
    raw: z.string().trim().min(1).max(80),
  })
  .strict();
export type CourseIdentity = z.infer<typeof courseIdentitySchema>;

export const selfAssessedLevelSchema = z.enum([
  'struggling',
  'okay',
  'confident',
]);
export type SelfAssessedLevel = z.infer<typeof selfAssessedLevelSchema>;

export const quietHoursSchema = z
  .object({
    /** Local time the quiet window opens, e.g. 21:00. */
    start: time,
    /** Local time it closes, e.g. 07:00. */
    end: time,
  })
  .strict();
export type QuietHours = z.infer<typeof quietHoursSchema>;

export const upcomingAssessmentSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(120).nullable(),
  })
  .strict();
export type UpcomingAssessment = z.infer<typeof upcomingAssessmentSchema>;

export const studentProfileSchema = z
  .object({
    /** What the student asked to be called. The only required answer. */
    displayName: z.string().trim().min(1).max(40),
    /** Upper-secondary year 1, 2, or 3. */
    schoolYear: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
    age: z.number().int().min(13).max(25).nullable(),
    /** Class group, e.g. "NA22B". */
    className: z.string().trim().max(20).nullable(),
    course: courseIdentitySchema.nullable(),
    /** Textbook title as the student named it, e.g. "Matematik 5000+ 2c". */
    textbook: z.string().trim().max(120).nullable(),
    /** Where the class is right now, in the student's own words. */
    currentTopic: z.string().trim().max(200).nullable(),
    selfAssessedLevel: selfAssessedLevelSchema.nullable(),
    previousGrade: z.string().trim().max(20).nullable(),
    lessonSlots: z.array(lessonSlotSchema).max(10).default([]),
    nextAssessment: upcomingAssessmentSchema.nullable(),
    quietHours: quietHoursSchema,
    timezone: z.string().min(1).default('Europe/Stockholm'),
    language: z.enum(['sv', 'en']).default('sv'),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type StudentProfile = z.infer<typeof studentProfileSchema>;

/** Nobody is messaged between 21:00 and 07:00 unless they say otherwise. */
export const DEFAULT_QUIET_HOURS: QuietHours = { start: '21:00', end: '07:00' };
