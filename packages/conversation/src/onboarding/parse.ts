import {
  DEFAULT_QUIET_HOURS,
  mathCourseCodeSchema,
  type CourseIdentity,
  type LessonSlot,
  type MathCourseCode,
  type QuietHours,
  type SelfAssessedLevel,
  type Weekday,
} from '@math-study-companion/contracts';

/**
 * Readers for what a student actually types.
 *
 * Every one of these returns null rather than guessing, so a step can ask again
 * instead of storing something invented (`docs/RULES.md` §3.5).
 */

/** Words that mean "I would rather not answer this one". */
const SKIP_WORDS = [
  'skip',
  'hoppa över',
  'hoppa over',
  'hoppa',
  'vet inte',
  'vet ej',
  'ingen aning',
  'senare',
  'nej',
  '-',
];

export function isSkip(reply: string): boolean {
  const value = reply.trim().toLowerCase();
  if (value === '') return true;
  return SKIP_WORDS.some((word) => value === word || value === `${word}.`);
}

/** Strips the polite padding students put around a short answer. */
export function plain(reply: string): string {
  return reply
    .trim()
    .replace(/^(jag heter|heter|mitt namn är|jag är|det är|kalla mig)\s+/i, '')
    .replace(/[.!]+$/, '')
    .trim();
}

export function parseName(reply: string): string | null {
  const value = plain(reply);
  if (value === '' || value.length > 40) return null;
  // A name is a word or two, not a sentence.
  if (value.split(/\s+/).length > 4) return null;
  return value;
}

const YEAR_WORDS: Record<string, 1 | 2 | 3> = {
  ettan: 1,
  etta: 1,
  första: 1,
  forsta: 1,
  tvåan: 2,
  tvaan: 2,
  andra: 2,
  trean: 3,
  tredje: 3,
};

export function parseSchoolYear(reply: string): 1 | 2 | 3 | null {
  const value = plain(reply).toLowerCase();
  for (const [word, year] of Object.entries(YEAR_WORDS)) {
    if (value.includes(word)) return year;
  }
  // "åk 2", "årskurs 2", "gymnasiet 2", or a bare "2".
  const digit = /(?:^|\D)([123])(?:\D|$)/.exec(value);
  if (digit) return Number(digit[1]) as 1 | 2 | 3;
  return null;
}

export function parseAge(reply: string): number | null {
  const match = /(\d{2})/.exec(plain(reply));
  if (!match) return null;
  const age = Number(match[1]);
  return age >= 13 && age <= 25 ? age : null;
}

export function parseClassName(reply: string): string | null {
  const value = plain(reply).toUpperCase();
  if (value === '' || value.length > 20) return null;
  return value;
}

/**
 * Reads a Swedish maths course name.
 *
 * Handles "Ma2c", "matte 2c", "matematik 2 c", and a bare "2c". Courses 4 and 5
 * have no track letter. An unrecognised answer still becomes a course — the raw
 * text is kept and the code stays null.
 */
export function parseCourse(reply: string): CourseIdentity | null {
  const raw = plain(reply);
  if (raw === '') return null;

  const value = raw.toLowerCase().replace(/[\s.]/g, '');
  const match = /(?:ma|matte|matematik)?([12345])([abc])?/.exec(value);
  if (match) {
    const level = match[1]!;
    const track = match[2];
    const candidate = `Ma${level}${level === '4' || level === '5' ? '' : (track ?? '')}`;
    const parsed = mathCourseCodeSchema.safeParse(candidate);
    if (parsed.success) {
      return { code: parsed.data, raw: raw.slice(0, 80) };
    }
  }
  return { code: null, raw: raw.slice(0, 80) };
}

/** The course track implies the difficulty of the questions that suit it. */
export function courseTrack(
  code: MathCourseCode | null,
): 'a' | 'b' | 'c' | null {
  if (!code) return null;
  const letter = code.slice(-1).toLowerCase();
  return letter === 'a' || letter === 'b' || letter === 'c' ? letter : null;
}

export function parseLevel(reply: string): SelfAssessedLevel | null {
  const value = plain(reply).toLowerCase();
  if (/(kämpar|kampar|svårt|svart|tungt|dåligt|daligt|struggl)/.test(value)) {
    return 'struggling';
  }
  if (
    /(säker|saker|bra|går bra|gar bra|lätt|latt|confident|good)/.test(value)
  ) {
    return 'confident';
  }
  if (/(okej|ok|sådär|sadar|medel|okay)/.test(value)) return 'okay';
  return null;
}

const WEEKDAYS: Array<{ day: Weekday; patterns: RegExp }> = [
  { day: 'monday', patterns: /\b(mån|man|mon)[a-zé]*\b/i },
  { day: 'tuesday', patterns: /\b(tis|tue)[a-z]*\b/i },
  { day: 'wednesday', patterns: /\b(ons|wed)[a-z]*\b/i },
  { day: 'thursday', patterns: /\b(tors|thu)[a-z]*\b/i },
  { day: 'friday', patterns: /\b(fre|fri)[a-z]*\b/i },
  { day: 'saturday', patterns: /\b(lör|lor|sat)[a-z]*\b/i },
  { day: 'sunday', patterns: /\b(sön|son|sun)[a-z]*\b/i },
];

/**
 * Reads a weekly lesson schedule out of a sentence.
 *
 * "tis 9.15 och tors 13" and "måndagar 08:00, onsdagar 10.15" both work. Each
 * weekday keeps the time that follows it; a weekday with no time is dropped,
 * because a lesson without a start is no use to the planner.
 */
export function parseLessonSlots(reply: string): LessonSlot[] {
  const value = plain(reply);
  if (value === '') return [];

  const found: Array<{ day: Weekday; index: number }> = [];
  for (const { day, patterns } of WEEKDAYS) {
    const match = patterns.exec(value);
    if (match) found.push({ day, index: match.index });
  }
  if (found.length === 0) return [];
  found.sort((a, b) => a.index - b.index);

  const slots: LessonSlot[] = [];
  for (const [position, entry] of found.entries()) {
    const until = found[position + 1]?.index ?? value.length;
    const segment = value.slice(entry.index, until);
    const time = parseTime(segment);
    if (time) slots.push({ weekday: entry.day, startsAt: time });
  }
  return slots.slice(0, 10);
}

/** Reads "9.15", "09:15", "13", or "kl 8" as a 24-hour time. */
export function parseTime(text: string): string | null {
  const match = /(\d{1,2})(?:[.:](\d{2}))?/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Reads "21-7", "22 till 06", or "efter 21" as a quiet window. */
export function parseQuietHours(reply: string): QuietHours | null {
  const value = plain(reply);
  if (value === '') return null;

  const range =
    /(\d{1,2}(?:[.:]\d{2})?)\s*(?:-|–|till|to)\s*(\d{1,2}(?:[.:]\d{2})?)/.exec(
      value,
    );
  if (range) {
    const start = parseTime(range[1]!);
    const end = parseTime(range[2]!);
    if (start && end) return { start, end };
  }

  const after = /(?:efter|after)\s*(\d{1,2}(?:[.:]\d{2})?)/.exec(value);
  if (after) {
    const start = parseTime(after[1]!);
    if (start) return { start, end: DEFAULT_QUIET_HOURS.end };
  }
  return null;
}

/** Reads "3 oktober", "3/10", or "2026-10-03" as a date. */
export function parseDate(reply: string, today: Date): string | null {
  const value = plain(reply).toLowerCase();
  if (value === '') return null;

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return iso[0];

  const months = [
    'januari',
    'februari',
    'mars',
    'april',
    'maj',
    'juni',
    'juli',
    'augusti',
    'september',
    'oktober',
    'november',
    'december',
  ];
  const named = /(\d{1,2})\s*(?:\.|:e)?\s*([a-zåäö]+)/.exec(value);
  if (named) {
    const month = months.findIndex((name) =>
      name.startsWith(named[2]!.slice(0, 3)),
    );
    if (month !== -1) {
      return isoDate(
        pickYear(today, month, Number(named[1])),
        month,
        Number(named[1]),
      );
    }
  }

  const numeric = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(value);
  if (numeric) {
    const month = Number(numeric[2]) - 1;
    const day = Number(numeric[1]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return isoDate(pickYear(today, month, day), month, day);
    }
  }
  return null;
}

/** A date already gone this year means the next one (a spring exam in autumn). */
function pickYear(today: Date, month: number, day: number): number {
  const thisYear = new Date(Date.UTC(today.getUTCFullYear(), month, day));
  return thisYear.getTime() >= startOfDay(today).getTime()
    ? today.getUTCFullYear()
    : today.getUTCFullYear() + 1;
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
