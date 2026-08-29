import {
  DEFAULT_QUIET_HOURS,
  studentProfileSchema,
  type CourseIdentity,
  type LessonSlot,
  type QuietHours,
  type SelfAssessedLevel,
  type StudentProfile,
  type UpcomingAssessment,
} from '@math-study-companion/contracts';

import {
  isSkip,
  parseAge,
  parseClassName,
  parseCourse,
  parseDate,
  parseLessonSlots,
  parseLevel,
  parseName,
  parseQuietHours,
  parseSchoolYear,
  plain,
} from './parse.js';
import {
  askStep,
  say,
  type OnboardingStep,
  type RunStepsInput,
} from './steps.js';

export const SETUP_PROMPT_VERSION = 'setup/2026-08-29.1';

const NAME_STEP: OnboardingStep<string> = {
  id: 'name',
  optional: false,
  prompt:
    'Hej! Jag heter Broski och ska plugga matte med dig. Vad ska jag kalla dig?',
  retryPrompt: 'Vad ska jag kalla dig? Bara förnamnet räcker.',
  parse: (reply) => parseName(reply),
};

/**
 * The questions after the greeting.
 *
 * Ordered so the ones that change what the companion does come first: a student
 * who stops answering halfway still leaves behind a course, a book, and a
 * starting point.
 */
const STEPS = [
  {
    id: 'course',
    optional: false,
    prompt: (answers) =>
      `Kul, ${answers['name'] as string}! Vilken matematikkurs läser du just nu? Till exempel Ma2c eller matte 3b.`,
    retryPrompt: 'Vilken mattekurs är det? Skriv den som den står i schemat.',
    parse: (reply, context) => {
      if (isSkip(reply)) return null;
      const course = parseCourse(reply);
      if (!course) return null;
      // An answer that matched no known course is worth one more try — but
      // whatever comes back the second time is kept as he said it, because a
      // course this code does not recognise is still his course.
      if (course.code === null && context.attempt === 0) return null;
      return course;
    },
  } satisfies OnboardingStep<CourseIdentity>,
  {
    id: 'textbook',
    optional: false,
    prompt:
      'Vilken bok använder ni? Till exempel Matematik 5000+, Exponent eller Origo.',
    retryPrompt: 'Vad heter boken ni har i matten?',
    parse: (reply) => {
      if (isSkip(reply)) return null;
      const value = plain(reply);
      return value === '' ? null : value.slice(0, 120);
    },
  } satisfies OnboardingStep<string>,
  {
    id: 'currentTopic',
    optional: false,
    prompt: 'Vad håller ni på med just nu i kursen?',
    retryPrompt: 'Vilket område jobbar ni med den här veckan?',
    parse: (reply) => {
      if (isSkip(reply)) return null;
      const value = plain(reply);
      return value === '' ? null : value.slice(0, 200);
    },
  } satisfies OnboardingStep<string>,
  {
    id: 'lessonSlots',
    optional: true,
    prompt:
      'Vilka dagar och tider har ni matte? Till exempel: tis 9.15 och tors 13.',
    parse: (reply) => {
      if (isSkip(reply)) return null;
      const slots = parseLessonSlots(reply);
      return slots.length > 0 ? slots : null;
    },
  } satisfies OnboardingStep<LessonSlot[]>,
  {
    id: 'level',
    optional: false,
    prompt: 'Hur känns matten just nu — kämpar, okej eller säker?',
    retryPrompt: 'Svara med kämpar, okej eller säker.',
    parse: (reply) => (isSkip(reply) ? null : parseLevel(reply)),
  } satisfies OnboardingStep<SelfAssessedLevel>,
  {
    id: 'schoolYear',
    optional: true,
    prompt: 'Vilken årskurs går du i — ettan, tvåan eller trean?',
    parse: (reply) => (isSkip(reply) ? null : parseSchoolYear(reply)),
  } satisfies OnboardingStep<1 | 2 | 3>,
  {
    id: 'age',
    optional: true,
    prompt: 'Hur gammal är du? Hoppa över om du hellre vill.',
    parse: (reply) => (isSkip(reply) ? null : parseAge(reply)),
  } satisfies OnboardingStep<number>,
  {
    id: 'className',
    optional: true,
    prompt: 'Vilken klass går du i? Till exempel NA22B.',
    parse: (reply) => (isSkip(reply) ? null : parseClassName(reply)),
  } satisfies OnboardingStep<string>,
  {
    id: 'nextAssessment',
    optional: true,
    prompt: 'Har du något prov inbokat? Skriv datumet, till exempel 3 oktober.',
    parse: (reply, context) => {
      if (isSkip(reply)) return null;
      const date = parseDate(reply, context.today);
      if (!date) return null;
      const note = plain(reply).replace(/\d.*$/, '').trim();
      return { date, note: note === '' ? null : note.slice(0, 120) };
    },
  } satisfies OnboardingStep<UpcomingAssessment>,
  {
    id: 'quietHours',
    optional: true,
    prompt:
      'När vill du vara ifred? Skriv till exempel 21-07, annars håller jag mig till just det.',
    parse: (reply) => (isSkip(reply) ? null : parseQuietHours(reply)),
  } satisfies OnboardingStep<QuietHours>,
  {
    id: 'previousGrade',
    optional: true,
    prompt:
      'Sista frågan: vilket betyg fick du senast i matte? Hoppa över om du hellre vill.',
    parse: (reply) => {
      if (isSkip(reply)) return null;
      const value = plain(reply).toUpperCase();
      return value === '' ? null : value.slice(0, 20);
    },
  } satisfies OnboardingStep<string>,
] as const;

/**
 * The first conversation: who the student is, what they study, and when they
 * may be interrupted.
 *
 * Nothing here is invented. Every optional answer may be skipped, and a
 * question that cannot be read twice is dropped rather than repeated.
 */
export async function runStudentSetup(
  input: RunStepsInput,
): Promise<StudentProfile> {
  const answers: Record<string, unknown> = {};
  // One anchor for the whole setup, so a burst of answers is read in order.
  const session: RunStepsInput = {
    ...input,
    anchor: input.anchor ?? { at: null },
  };
  input = session;

  const name = await askStep(input, NAME_STEP, answers);
  answers['name'] = name ?? 'du';

  await say(
    input,
    'intro',
    `Trevligt att träffas! ${STEPS.length} korta frågor, sen sätter vi igång.`,
  );

  for (const step of STEPS) {
    answers[step.id] = await askStep(
      input,
      step as OnboardingStep<unknown>,
      answers,
    );
  }

  const profile = studentProfileSchema.parse({
    displayName: name ?? 'du',
    schoolYear: answers['schoolYear'] ?? null,
    age: answers['age'] ?? null,
    className: answers['className'] ?? null,
    course: answers['course'] ?? null,
    textbook: answers['textbook'] ?? null,
    currentTopic: answers['currentTopic'] ?? null,
    selfAssessedLevel: answers['level'] ?? null,
    previousGrade: answers['previousGrade'] ?? null,
    lessonSlots: answers['lessonSlots'] ?? [],
    nextAssessment: answers['nextAssessment'] ?? null,
    quietHours: answers['quietHours'] ?? DEFAULT_QUIET_HOURS,
    updatedAt: new Date().toISOString(),
  });

  await say(input, 'summary', summarise(profile));
  return profile;
}

/** What the companion understood, so a wrong answer is visible immediately. */
export function summarise(profile: StudentProfile): string {
  const lines = [`Då har jag det här om dig, ${profile.displayName}:`];

  if (profile.course) {
    lines.push(`Kurs: ${profile.course.code ?? profile.course.raw}`);
  }
  if (profile.textbook) lines.push(`Bok: ${profile.textbook}`);
  if (profile.currentTopic) lines.push(`Just nu: ${profile.currentTopic}`);
  if (profile.lessonSlots.length > 0) {
    lines.push(
      `Lektioner: ${profile.lessonSlots.map(describeSlot).join(', ')}`,
    );
  }
  if (profile.nextAssessment) {
    lines.push(`Prov: ${profile.nextAssessment.date}`);
  }
  lines.push(
    `Jag skriver inte mellan ${profile.quietHours.start} och ${profile.quietHours.end}.`,
  );
  lines.push('Stämmer det inte, skriv om så ändrar jag.');
  return lines.join('\n');
}

const WEEKDAY_NAMES: Record<LessonSlot['weekday'], string> = {
  monday: 'mån',
  tuesday: 'tis',
  wednesday: 'ons',
  thursday: 'tors',
  friday: 'fre',
  saturday: 'lör',
  sunday: 'sön',
};

function describeSlot(slot: LessonSlot): string {
  return `${WEEKDAY_NAMES[slot.weekday]} ${slot.startsAt}`;
}
