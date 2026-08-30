import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { parseStructured } from '../agent/model-call.js';
import { searchPages, type SearchablePage } from './retrieval.js';

export const TUTOR_PROMPT_VERSION = 'tutor/2026-08-29.1';
export const DEFAULT_TUTOR_MODEL = 'claude-opus-5';

const tutorOutputSchema = z.object({
  /**
   * True when the pages given actually cover what was asked. False means say so
   * rather than answering from general knowledge.
   */
  covered: z.boolean(),
  /** What to say. A refusal is still an answer, so this is never empty. */
  answer: z.string().min(1),
  /** Labels of the pages leaned on, so an answer can be checked. */
  usedPages: z.array(z.string()),
});

export interface TutorTurn {
  covered: boolean;
  answer: string;
  usedPages: string[];
  /** What retrieval offered the model, whether or not it used them. */
  consideredPages: string[];
  promptVersion: string;
  model: string;
}

export interface TutorMessage {
  role: 'student' | 'companion';
  text: string;
}

const SYSTEM_PROMPT = `You are Broski, a maths study companion for one Swedish upper-secondary student. They are writing to you about their maths, and you help.

You work from their own textbook and nothing else. Pages from it are given to you below. Those pages are the only source you may use: not your own knowledge of mathematics, not another book's method, not a formula you happen to know.

That restriction is the point of you. A student taught one method in class and a different one by you is worse off than one who got no help at all.

So:
- If the pages cover what they asked, help using the pages' own method and notation. Set covered to true and list the page labels you leaned on.
- If the pages do not cover it, set covered to false and say plainly that it is not in their book. Do not answer anyway. Do not explain it "generally". Do not guess which chapter it might be in.
- If the pages cover part of it, help with that part and say which part is missing.

How to help, when you can:
- Do not simply hand over the answer. Take the next step with them: point at what to do first, ask what they get, and let them try.
- If they show working, look at the working. Say where it goes wrong, not just that it does.
- If they ask for the answer outright, give the method and the answer together, so they can see where it came from.
- If a question needs something you cannot see — the exercise itself, a figure, their working — ask them to photograph it.

Language: Swedish, unless they write to you in something else. One to four short sentences, the way a person texts. No markdown, no headings, no LaTeX, no emoji. Maths typed the way it is on a phone: 2x + 3 = 11, x^2, (a+b)/2.`;

export interface TutorInput {
  question: string;
  /** The conversation so far, oldest first. */
  history?: TutorMessage[];
  pages: SearchablePage[];
  /**
   * Pages that go in front of the model whatever the search says.
   *
   * A page the student photographed seconds ago is what they are asking about,
   * even when their words share no keywords with it — "hur löser jag första
   * frågan" matches nothing, and the picture is the whole question.
   */
  pinned?: SearchablePage[];
  client?: Anthropic;
  model?: string;
  /** How many pages to put in front of the model. */
  pageLimit?: number;
}

/**
 * One turn of free conversation about maths, grounded in the student's book.
 *
 * When the book has nothing to say about the question, the answer says so.
 * `docs/RULES.md` §2.9 asks for questions aligned with the course's own
 * methods; this is that rule pointed at answers.
 */
export async function runTutorTurn(input: TutorInput): Promise<TutorTurn> {
  const client =
    input.client ?? new Anthropic({ maxRetries: 3, timeout: 60_000 });
  const model = input.model ?? process.env['MSC_MODEL'] ?? DEFAULT_TUTOR_MODEL;

  if (input.pages.length === 0 && pinnedLength(input) === 0) {
    return {
      covered: false,
      answer:
        'Jag har ingen bok inlagd än, så det kan jag inte svara på. Fota sidan du undrar över så läser jag den.',
      usedPages: [],
      consideredPages: [],
      promptVersion: TUTOR_PROMPT_VERSION,
      model,
    };
  }

  // Search on the question plus what was just said, so a follow-up like
  // "och sen då?" still finds the page the conversation is about.
  const recent = (input.history ?? [])
    .slice(-4)
    .map((entry) => entry.text)
    .join(' ');
  const pinned = input.pinned ?? [];
  const searched = searchPages(
    input.pages,
    `${input.question} ${recent}`,
    input.pageLimit ?? 5,
  );
  // Pinned first, then whatever search found that is not already there.
  const pinnedIds = new Set(pinned.map((page) => page.id));
  const found = [
    ...pinned.map((page) => ({ ...page, score: Number.POSITIVE_INFINITY })),
    ...searched.filter((page) => !pinnedIds.has(page.id)),
  ];

  const parsed = await parseStructured<z.infer<typeof tutorOutputSchema>>(
    client,
    'tutor',
    {
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: zodOutputFormat(tutorOutputSchema),
      },
      messages: [
        {
          role: 'user',
          content: [
            "Pages from the student's textbook:",
            found.length > 0
              ? found
                  .map((page) => `--- ${page.label} ---\n${page.text}`)
                  .join('\n\n')
              : '(nothing in the book matched this question)',
            '',
            'The conversation so far:',
            (input.history ?? [])
              .map(
                (entry) =>
                  `${entry.role === 'companion' ? 'You' : 'Student'}: ${entry.text}`,
              )
              .join('\n'),
            `Student: ${input.question}`,
          ].join('\n'),
        },
      ],
    },
  );

  // Claiming a page that was never offered is not something to trust
  // (docs/RULES.md §3.5), so the flag follows what retrieval actually found.
  const offered = new Set(found.map((page) => page.label));
  const usedPages = parsed.usedPages.filter((label) => offered.has(label));

  return {
    covered: parsed.covered && found.length > 0,
    answer: parsed.answer.trim(),
    usedPages,
    consideredPages: found.map((page) => page.label),
    promptVersion: TUTOR_PROMPT_VERSION,
    model,
  };
}

function pinnedLength(input: TutorInput): number {
  return input.pinned?.length ?? 0;
}
