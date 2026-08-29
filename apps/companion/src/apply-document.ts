import type { StudentProfile } from '@math-study-companion/contracts';
import type {
  DocumentReading,
  PlanRow,
} from '@math-study-companion/conversation';
import type {
  CoursePlan,
  Lesson,
  StudyItem,
} from '@math-study-companion/planning';

/**
 * Turns a document the student sent into the two files the planner reads.
 *
 * A school term plan already says which lesson covers what — the one mapping
 * this system could never work out on its own. Reading it off a photo is the
 * difference between a calendar of empty slots and a companion that knows
 * tomorrow's lesson is the factor theorem.
 */

export interface ApplyResult {
  coursePlan: CoursePlan | null;
  studyItems: StudyItem[];
  /** Set when the document named a test the student did not already have. */
  nextAssessment: StudentProfile['nextAssessment'];
  /** What to tell the student, in their language. */
  message: string;
  /** Rows that could not be placed on a date, for the operator to see. */
  undated: PlanRow[];
}

const DEFAULT_LESSON_TIME = '08:00';

export function applyDocument(
  reading: DocumentReading,
  context: {
    profile: StudentProfile;
    coursePlan: CoursePlan;
    studyItems: StudyItem[];
    today?: Date;
  },
): ApplyResult {
  const today = context.today ?? new Date();

  if (reading.kind === 'unreadable') {
    return empty(
      'Jag får inte ut något av den bilden. Ta en till rakt uppifrån, gärna i bättre ljus.',
    );
  }

  if (reading.kind === 'assignment' || reading.kind === 'material') {
    const item = itemFromText(reading);
    if (!item) {
      return empty('Jag kunde läsa den, men hittade inget att öva på i den.');
    }
    return {
      coursePlan: null,
      studyItems: mergeItems(context.studyItems, [item]),
      nextAssessment: null,
      undated: [],
      message: `Sparat: ${reading.summary}. Jag kan ställa frågor på det.`,
    };
  }

  if (reading.kind !== 'course_plan' && reading.kind !== 'schedule') {
    return empty(
      `Jag ser vad det är (${reading.summary}), men jag vet inte vad jag ska göra med den. Skicka din planering eller ditt schema om du har det.`,
    );
  }

  const dated = reading.rows.filter((row) => row.date !== null);
  const undated = reading.rows.filter((row) => row.date === null);

  const items = mergeItems(
    context.studyItems,
    reading.rows
      .map(itemFromRow)
      .filter((item): item is StudyItem => item !== null),
  );

  const lessons = dated.map((row) => toLesson(row, context.profile));
  const coursePlan: CoursePlan | null =
    lessons.length > 0
      ? {
          courseName:
            reading.courseName ??
            context.profile.course?.code ??
            context.coursePlan.courseName,
          timezone: context.profile.timezone,
          lessons: mergeLessons(context.coursePlan.lessons, lessons),
        }
      : null;

  return {
    coursePlan,
    studyItems: items,
    nextAssessment: nextAssessmentFrom(reading.rows, today),
    undated,
    message: describe(reading, lessons.length, undated.length),
  };
}

function empty(message: string): ApplyResult {
  return {
    coursePlan: null,
    studyItems: [],
    nextAssessment: null,
    undated: [],
    message,
  };
}

/** A plan row becomes a study item; the topic and reference are all we have. */
function itemFromRow(row: PlanRow): StudyItem | null {
  const topic = row.topic.trim();
  if (topic === '') return null;

  const sourceText = row.reference
    ? `${topic}. Enligt planeringen: ${row.reference}.`
    : topic;

  return {
    id: slug(topic),
    topic,
    sourceText,
    difficulty: 'medium',
    image: null,
  };
}

/** An assignment or a page of the book gives real text to build questions on. */
function itemFromText(reading: DocumentReading): StudyItem | null {
  const text = reading.extractedText?.trim();
  if (!text) return null;
  const topic = reading.summary.trim() || 'Uppladdat material';
  return {
    id: slug(topic),
    topic,
    sourceText: text.slice(0, 2000),
    difficulty: 'medium',
    image: null,
  };
}

function toLesson(row: PlanRow, profile: StudentProfile): Lesson {
  const date = row.date!;
  const item = itemFromRow(row);
  return {
    id: `plan-${date}-${slug(row.topic).slice(0, 24)}`,
    startsAt: `${date} ${timeForDate(date, profile)}`,
    topic: row.topic.trim(),
    // This is the mapping the whole planner was missing.
    covers: item ? [item.id] : [],
    prepares: [],
  };
}

/**
 * What time that lesson starts.
 *
 * A term plan says which day, and the timetable the student already gave says
 * what time that weekday's lesson runs. Where the two disagree or the day is
 * unknown, a plain morning slot is used rather than a made-up time.
 */
function timeForDate(date: string, profile: StudentProfile): string {
  const weekday = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ][new Date(`${date}T12:00:00Z`).getUTCDay()];
  const slot = profile.lessonSlots.find((entry) => entry.weekday === weekday);
  return slot?.startsAt ?? DEFAULT_LESSON_TIME;
}

/** The soonest test the plan names, if any. */
function nextAssessmentFrom(
  rows: PlanRow[],
  today: Date,
): StudentProfile['nextAssessment'] {
  const upcoming = rows
    .filter((row) => row.isAssessment && row.date !== null)
    .filter((row) => Date.parse(`${row.date}T23:59:59Z`) >= today.getTime())
    .sort((a, b) => a.date!.localeCompare(b.date!))[0];

  if (!upcoming) return null;
  return { date: upcoming.date!, note: upcoming.topic.slice(0, 120) };
}

/** New rows replace same-id items; nothing already there is lost. */
function mergeItems(existing: StudyItem[], incoming: StudyItem[]): StudyItem[] {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, item);
  return [...merged.values()];
}

/** A lesson at the same start time replaces the one already there. */
function mergeLessons(existing: Lesson[], incoming: Lesson[]): Lesson[] {
  const merged = new Map(existing.map((lesson) => [lesson.startsAt, lesson]));
  for (const lesson of incoming) merged.set(lesson.startsAt, lesson);
  return [...merged.values()].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
}

function describe(
  reading: DocumentReading,
  dated: number,
  undated: number,
): string {
  if (dated === 0 && undated === 0) {
    return 'Jag kunde läsa den, men hittade inga lektioner i den.';
  }

  const parts = [`Läste ${reading.summary}.`];
  if (dated > 0) {
    parts.push(`Jag la in ${dated} lektioner med datum och vad de handlar om.`);
  }
  if (undated > 0) {
    parts.push(
      `${undated} rader saknade datum, så dem lade jag bara som områden att öva på.`,
    );
  }
  if (reading.confidence < 0.6) {
    parts.push('Bilden var svårläst, så kolla gärna att det blev rätt.');
  }
  return parts.join(' ');
}

/** A stable id from a topic: "Andragradsekvationer, pq" -> "andragradsekvationer-pq". */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'amne'
  );
}
