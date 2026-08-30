import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { DownloadedAttachment } from '../messaging/port.js';
import { toModelContentBlock } from './attachment-block.js';
import { parseStructured } from './model-call.js';

/**
 * Reads what a student photographed or uploaded.
 *
 * Schools hand out a plan for the term — which lesson covers what, which pages
 * to read, when the test is. That sheet is exactly the mapping the planner
 * cannot invent, so being able to read a photo of it is worth more than any
 * amount of manual configuration.
 */

export const DOCUMENT_PROMPT_VERSION = 'document/2026-08-29.1';
/** Same default as the study agent; overridden together by MSC_MODEL. */
export const DEFAULT_DOCUMENT_MODEL = 'claude-opus-5';

/** What the upload turned out to be. */
export const documentKindSchema = z.enum([
  /** A term plan: dated lessons with topics, pages, or exercises. */
  'course_plan',
  /** A timetable: which days and times, without content. */
  'schedule',
  /** Exercises or a task sheet. */
  'assignment',
  /** A page of the textbook or notes. */
  'material',
  /** Legible, but none of the above. */
  'other',
  /** Not legible enough to use. */
  'unreadable',
]);
export type DocumentKind = z.infer<typeof documentKindSchema>;

/**
 * One row of a term plan.
 *
 * Every field is nullable because a real sheet is uneven: a row may give a week
 * number and no date, or a topic and no pages. A row that cannot be read is
 * dropped rather than filled in, per `docs/RULES.md` §3.5.
 */
export const planRowSchema = z.object({
  /** ISO date, when the sheet states one plainly. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** What the sheet says about when, verbatim: "v. 38", "tis 9/9". */
  whenText: z.string().nullable(),
  /** What that lesson covers, in the sheet's own words. */
  topic: z.string(),
  /** Pages, sections, or exercise numbers named for that lesson. */
  reference: z.string().nullable(),
  /** True when the row marks a test, quiz, or hand-in. */
  isAssessment: z.boolean(),
});
export type PlanRow = z.infer<typeof planRowSchema>;

export const documentReadingSchema = z.object({
  kind: documentKindSchema,
  /** One sentence a student would recognise: "Planering Ma2c, v. 35-43". */
  summary: z.string(),
  /** Course name if the sheet names one. */
  courseName: z.string().nullable(),
  rows: z.array(planRowSchema),
  /** Plain text worth keeping when the upload is material or an assignment. */
  extractedText: z.string().nullable(),
  /** 0-1. Low means the photo was hard to read, not that the sheet was odd. */
  confidence: z.number().min(0).max(1),
});
export type DocumentReading = z.infer<typeof documentReadingSchema>;

export interface DocumentReader {
  read(file: DownloadedAttachment): Promise<DocumentReading>;
}

const SYSTEM_PROMPT = `You read a photo or file a Swedish upper-secondary student sent to their maths study companion. It is usually a term plan from school, a timetable, an assignment sheet, or a page from the textbook.

Your job is to write down what is actually on it. You are not tutoring here and not summarising loosely: another program will act on what you return.

Decide what the document is:
- course_plan: dated or week-numbered lessons with topics, pages, or exercises.
- schedule: days and times only, no content.
- assignment: exercises or a task the student has to do.
- material: a page of the book, notes, or a worked example.
- other: legible, but none of the above.
- unreadable: too blurred, cropped, or dark to use.

For a course plan or schedule, return one row per lesson or line, in the order they appear:
- date: only when the sheet states a real date you can resolve to YYYY-MM-DD. A week number alone is not a date — leave it null.
- whenText: exactly what the sheet says about when, even when you filled in date. "v. 38", "tis 9/9", "Lektion 4".
- topic: what that lesson covers, in the sheet's own words. Do not translate and do not improve it.
- reference: pages, sections, or exercise numbers named for that lesson, verbatim.
- isAssessment: true when the row is a test, quiz, national test, or hand-in.

Rules that matter more than completeness:
- Never invent a date, topic, page number, or row. A row you cannot read is left out.
- Never carry a topic from one row into another that lacks one.
- Keep the student's language. A Swedish sheet stays Swedish.
- If the image is too poor to trust, return kind "unreadable" with no rows, rather than a careful guess.

For assignment or material, put the readable text — including the maths, typed the way it is written — in extractedText and leave rows empty.

confidence is how well you could read the document itself, from 0 to 1. A crisp screenshot is near 1; a dim photo at an angle with half a column cut off is low, and should say so.`;

/** Reads a document with Claude's vision. */
export class ClaudeDocumentReader implements DocumentReader {
  readonly #client: Anthropic;
  readonly #model: string;

  constructor(options: { client?: Anthropic; model?: string } = {}) {
    this.#client =
      options.client ?? new Anthropic({ maxRetries: 3, timeout: 120_000 });
    this.#model =
      options.model ?? process.env['MSC_MODEL'] ?? DEFAULT_DOCUMENT_MODEL;
  }

  async read(file: DownloadedAttachment): Promise<DocumentReading> {
    const source = toModelContentBlock(file);
    const today = new Date().toISOString().slice(0, 10);

    return parseStructured<DocumentReading>(this.#client, 'readDocument', {
      model: this.#model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: zodOutputFormat(documentReadingSchema),
      },
      messages: [
        {
          role: 'user',
          content: [
            source,
            {
              type: 'text',
              // Dates on a school plan are often "9/9" with no year.
              text: `Today is ${today}. Read this document.`,
            },
          ],
        },
      ],
    });
  }
}
