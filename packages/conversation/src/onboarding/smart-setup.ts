import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import {
  DEFAULT_QUIET_HOURS,
  studentProfileSchema,
  type StudentProfile,
} from '@math-study-companion/contracts';

import { ModelCallError, parseStructured } from '../agent/model-call.js';
import {
  parseCourse,
  parseLessonSlots,
  parseQuietHours,
  parseTime,
} from './parse.js';
import { summarise } from './student-setup.js';
import { say, type RunStepsInput } from './steps.js';

export const SMART_SETUP_PROMPT_VERSION = 'smart-setup/2026-08-29.1';
/** Same default as the study agent; overridden together by MSC_MODEL. */
export const DEFAULT_SETUP_MODEL = 'claude-opus-5';
/** A setup that has not finished by here is going in circles. */
export const MAX_SETUP_TURNS = 20;

/**
 * What the companion learned from the last thing the student wrote.
 *
 * Every field is nullable and means "not learned this turn" — never "cleared".
 * A student who mentions three things in one sentence has all three read at
 * once, which is the whole point of not asking a list of questions.
 */
const learnedSchema = z.object({
  displayName: z.string().nullable(),
  /** Free text; the code resolves it to a course code, or keeps it raw. */
  course: z.string().nullable(),
  textbook: z.string().nullable(),
  currentTopic: z.string().nullable(),
  /** Free text about the timetable: "tis 9.15 och tors 13". */
  lessonTimes: z.string().nullable(),
  selfAssessedLevel: z.enum(['struggling', 'okay', 'confident']).nullable(),
  schoolYear: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  age: z.number().int().nullable(),
  className: z.string().nullable(),
  nextAssessmentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  nextAssessmentNote: z.string().nullable(),
  /** Free text: "efter 21", "21-07". */
  quietHours: z.string().nullable(),
  previousGrade: z.string().nullable(),
});

const setupTurnSchema = z.object({
  learned: learnedSchema,
  /** What to say next. One or two sentences. */
  message: z.string().min(1),
  /** True when there is nothing left worth asking. */
  done: z.boolean(),
});

const SYSTEM_PROMPT = `You are Broski, a maths study companion for one Swedish upper-secondary student. This is your first conversation with them, and your job is to get to know them well enough to be useful — not to fill in a form.

Write in Swedish unless they write to you in something else. Keep every message to one or two short sentences, the way a person texts. No markdown, no emoji, no lists.

What is worth knowing, roughly in order of how much it changes what you can do:

1. What to call them.
2. Which maths course they take (Ma1c, Ma2c, Ma3b, and so on).
3. Which textbook the class uses.
4. What the class is working on right now.
5. Which days and times they have maths.
6. Whether maths feels hard, okay, or fine right now.
7. Any test coming up.
8. When they do not want to be disturbed.
9. Year, age, class group — small talk that helps you sound like you know them.

How to run the conversation:

- Read everything they write. If one sentence answers three things, take all three and never ask about them again.
- Ask about one thing at a time, and pick the most useful thing still missing.
- If they have their school's term plan or timetable, ask them to photograph it instead of typing it out. That single photo answers 3, 4, 5 and 7 at once, so ask for it early — as soon as you know which course they take.
- If they say they do not have one, drop it immediately and never ask again.
- If they do not want to answer something, move on without comment. Nothing here is required except what to call them.
- If they ask you something, answer it in a sentence, then carry on.
- When they say something you did not expect, react to it like a person would before continuing.

Fill "learned" with only what this last message actually told you. Leave a field null when it did not. Never guess a course code, a date, or a time from something vague — a later message will say it plainly, or it will not matter.

Set "done" to true when you know what to call them and have either asked about everything worth asking or been told to stop. When you set done, your message should say briefly what you will do next, not list what you collected — the program prints that itself.`;

export interface SmartSetupInput extends RunStepsInput {
  client?: Anthropic;
  model?: string;
  /**
   * Called when the student sends something that is not text, so the caller can
   * read a photo and tell the conversation what it found.
   */
  onAttachment?: (event: {
    text: string;
    attachments: unknown[];
  }) => Promise<string | null>;
}

/**
 * The first conversation, driven by the model rather than a fixed list.
 *
 * The questionnaire in `student-setup.ts` still exists and still runs without
 * an API key. This is what runs when there is one: it reads what the student
 * actually wrote, takes several answers out of one sentence, and asks for a
 * photo of the school's plan as soon as that would save typing.
 */
export async function runSmartSetup(
  input: SmartSetupInput,
): Promise<StudentProfile> {
  const client =
    input.client ?? new Anthropic({ maxRetries: 3, timeout: 60_000 });
  const model = input.model ?? process.env['MSC_MODEL'] ?? DEFAULT_SETUP_MODEL;
  const anchor = input.anchor ?? { at: null };
  const session: SmartSetupInput = { ...input, anchor };

  const transcript: Array<{ role: 'companion' | 'student'; text: string }> = [];
  let profile = blankProfile();

  const opening =
    'Hej! Jag heter Broski och ska plugga matte med dig. Vad ska jag kalla dig?';
  await say(session, 'open', opening);
  transcript.push({ role: 'companion', text: opening });

  for (let turn = 0; turn < MAX_SETUP_TURNS; turn += 1) {
    const reply = await waitForStudent(session);
    if (!reply) break;
    transcript.push({ role: 'student', text: reply });

    let next;
    try {
      next = await parseStructured<z.infer<typeof setupTurnSchema>>(
        client,
        'setup',
        {
          model,
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          output_config: {
            effort: 'low',
            format: zodOutputFormat(setupTurnSchema),
          },
          messages: [
            {
              role: 'user',
              content: [
                'What you know so far:',
                describeKnown(profile),
                '',
                'The conversation:',
                transcript
                  .map(
                    (entry) =>
                      `${entry.role === 'companion' ? 'You' : 'Student'}: ${entry.text}`,
                  )
                  .join('\n'),
              ].join('\n'),
            },
          ],
        },
      );
    } catch (error) {
      if (error instanceof ModelCallError) {
        await say(session, `error-${turn}`, error.studentMessage);
        throw error;
      }
      throw error;
    }

    profile = merge(profile, next.learned);
    await say(session, `turn-${turn}`, next.message);
    transcript.push({ role: 'companion', text: next.message });

    if (next.done && profile.displayName !== '') break;
  }

  const finished = studentProfileSchema.parse({
    ...profile,
    displayName: profile.displayName || 'du',
    updatedAt: new Date().toISOString(),
  });

  await say(session, 'summary', summarise(finished));
  return finished;
}

async function waitForStudent(input: SmartSetupInput): Promise<string | null> {
  const anchor = input.anchor ?? { at: null };
  anchor.at ??= new Date();
  const reply = await input.inbox.waitFor(input.conversationId, {
    notBefore: anchor.at,
    timeoutMs: input.timeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!reply) return null;
  input.onMessage?.({ role: 'student', text: reply.text });
  return reply.text;
}

/**
 * Folds what the model heard into the profile.
 *
 * Free text goes through the same deterministic readers the questionnaire uses,
 * so a course code, a time, or a schedule is normalised here rather than taken
 * on the model's word (`docs/RULES.md` §3.1).
 */
function merge(
  profile: RawProfile,
  learned: z.infer<typeof learnedSchema>,
): RawProfile {
  const next: RawProfile = { ...profile };

  if (learned.displayName) next.displayName = learned.displayName.slice(0, 40);
  if (learned.course) next.course = parseCourse(learned.course);
  if (learned.textbook) next.textbook = learned.textbook.slice(0, 120);
  if (learned.currentTopic)
    next.currentTopic = learned.currentTopic.slice(0, 200);
  if (learned.lessonTimes) {
    const slots = parseLessonSlots(learned.lessonTimes);
    if (slots.length > 0) next.lessonSlots = slots;
  }
  if (learned.selfAssessedLevel)
    next.selfAssessedLevel = learned.selfAssessedLevel;
  if (learned.schoolYear) next.schoolYear = learned.schoolYear;
  if (learned.age !== null && learned.age >= 13 && learned.age <= 25) {
    next.age = learned.age;
  }
  if (learned.className) next.className = learned.className.slice(0, 20);
  if (learned.nextAssessmentDate) {
    next.nextAssessment = {
      date: learned.nextAssessmentDate,
      note: learned.nextAssessmentNote?.slice(0, 120) ?? null,
    };
  }
  if (learned.quietHours) {
    next.quietHours =
      parseQuietHours(learned.quietHours) ??
      quietFromSingleTime(learned.quietHours) ??
      next.quietHours;
  }
  if (learned.previousGrade) {
    next.previousGrade = learned.previousGrade.slice(0, 20).toUpperCase();
  }
  return next;
}

/** "efter 22" already works; a bare "22" is treated the same way. */
function quietFromSingleTime(
  text: string,
): StudentProfile['quietHours'] | null {
  const time = parseTime(text);
  return time ? { start: time, end: DEFAULT_QUIET_HOURS.end } : null;
}

type RawProfile = Omit<StudentProfile, 'updatedAt'>;

function blankProfile(): RawProfile {
  return {
    displayName: '',
    schoolYear: null,
    age: null,
    className: null,
    course: null,
    textbook: null,
    currentTopic: null,
    selfAssessedLevel: null,
    previousGrade: null,
    lessonSlots: [],
    nextAssessment: null,
    quietHours: DEFAULT_QUIET_HOURS,
    timezone: 'Europe/Stockholm',
    language: 'sv',
  };
}

/** What the model is told it already has, so it stops asking for it. */
function describeKnown(profile: RawProfile): string {
  const lines = [
    `name: ${profile.displayName || 'not known'}`,
    `course: ${profile.course ? (profile.course.code ?? profile.course.raw) : 'not known'}`,
    `textbook: ${profile.textbook ?? 'not known'}`,
    `current topic: ${profile.currentTopic ?? 'not known'}`,
    `lesson times: ${
      profile.lessonSlots.length > 0
        ? profile.lessonSlots
            .map((slot) => `${slot.weekday} ${slot.startsAt}`)
            .join(', ')
        : 'not known'
    }`,
    `how it feels: ${profile.selfAssessedLevel ?? 'not known'}`,
    `next test: ${profile.nextAssessment?.date ?? 'not known'}`,
    `quiet hours: ${profile.quietHours.start}-${profile.quietHours.end}`,
    `year/age/class: ${profile.schoolYear ?? '?'} / ${profile.age ?? '?'} / ${profile.className ?? '?'}`,
  ];
  return lines.join('\n');
}
