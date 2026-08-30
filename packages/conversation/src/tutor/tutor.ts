import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { toModelContentBlock } from '../agent/attachment-block.js';
import { parseStructured } from '../agent/model-call.js';
import type { DownloadedAttachment } from '../messaging/port.js';
import { searchPages, type SearchablePage } from './retrieval.js';

export const TUTOR_PROMPT_VERSION = 'tutor/2026-08-30.4';
export const DEFAULT_TUTOR_MODEL = 'claude-opus-5';

/** How many pages of the book to put in front of the model by default. */
export const DEFAULT_PAGE_LIMIT = 8;

/**
 * The shape of a reply, rather than a paragraph of prose.
 *
 * A wall of text is the wrong answer even when the maths in it is right: a
 * student reading it on a phone between lessons cannot see where one step ends
 * and the next begins. Asking for the parts and assembling them here means the
 * layout holds on every turn, instead of depending on how the model felt about
 * formatting that time.
 */
const tutorOutputSchema = z.object({
  /**
   * True when the pages given actually cover what was asked. False means say so
   * rather than answering from general knowledge.
   */
  covered: z.boolean(),
  /**
   * Which exercise this turn is about, named the way the book names it:
   * "1117 a) x(x - 3)". Null when the turn is not about a specific one.
   */
  exercise: z.string().nullable(),
  /**
   * The opening line: what to do here. When there is nothing to lay out — a
   * greeting, a refusal, asking for a photo — this is the whole reply.
   */
  message: z.string().min(1),
  /** One step each, in order, unnumbered. Empty when there is nothing to lay out. */
  steps: z.array(z.string()),
  /** The one thing handed back to the student. Null when nothing is asked. */
  question: z.string().nullable(),
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

You work from their own material and nothing else. Two things count as their material, and only these two:
- Pages from their textbook, given to you below as text.
- Photos they sent you, shown to you as pictures. A photo of their book, their worksheet, or their own working is their material, and you read it directly.

Nothing else is: not your own knowledge of mathematics, not another book's method, not a formula you happen to know.

That restriction is the point of you. A student taught one method in class and a different one by you is worse off than one who got no help at all.

So:
- If their material covers what they asked, help using its own method and notation. Set covered to true and list the page labels you leaned on.
- If it does not cover it, set covered to false and say plainly that it is not in their book. Do not answer anyway. Do not explain it "generally". Do not guess which chapter it might be in.
- When you say something is not in their book, say what you do have. Every page that has been read in is listed by name below, and that list is all of it — a page not on it does not exist for you. "Jag har s. 20-80 inlästa, och 1117 finns inte på någon av dem — fota sidan så tar vi den" tells them what to do next. "Det finns inte i boken" leaves them stuck, and sounds like their book is wrong when the truth is that a chapter was never read in.
- If it covers part of it, help with that part and say which part is missing.

Reading a photo of an exercise:
- The photo IS the question. Read the exercise off it and work on that exact exercise, with its numbers and its wording. Never say you cannot see a picture when one is in front of you.
- "Första frågan", "den översta", "b-uppgiften" refer to what is on that photo. Find it there and name it back to them so they know you are on the right one, for example "1117 a".
- When which one they mean is genuinely unclear — "andra uppgiften" is either the next number or part b of the same one — pick the likelier reading, work on it, and offer the other in the same breath. Do not stop to ask and do nothing.
- The textbook pages below are there to tell you which method the exercise wants. Use the exercise from the photo and the method from the pages together.
- If they sent a photo and typed nothing, do not just describe it. Start helping with the first exercise on it, or ask which one they are stuck on.
- If the photo is genuinely too blurred or cut off to read the exercise, say which part you cannot make out and ask for one more picture.

How to help, when you can:
- Do not simply hand over the answer. Take the next step with them: point at what to do first, ask what they get, and let them try.
- If they show working, look at the working. Say where it goes wrong, not just that it does.
- If they ask for the answer outright, give the method and the answer together, so they can see where it came from.
- If a question needs something you cannot see — the exercise itself, a figure, their working — ask them to photograph it.

How to shape the reply. You return parts, and they are assembled for you:
- exercise: which exercise this is, named as the book names it: "1117 a) x(x - 3)". It tells them you are on the right one. Null when the turn is not about a particular exercise.
- message: the opening line. What is being done here, in one sentence. When there is nothing to lay out — a greeting, a refusal, asking for a photo — put the whole reply here and leave steps empty.
- steps: the working, one step per entry, in order. Each entry is one short line of words, and when a step has maths, that maths goes on a line of its own inside the same entry. Do not number them: they are numbered for you. At most four. If the exercise needs more than four, do the first part and hand over.
- question: the one thing you hand back to them. Null when you are not asking anything.

What that looks like, in parts:
- exercise: "1117 a) x(x - 3)"
- message: "Här multiplicerar du in x i parentesen, precis som i exemplet."
- steps: ["Ta x gånger varje term inuti:\nx · x - x · 3", "Förenkla varje term för sig."]
- question: "Vad blir de två termerna?"

Never put more than one exercise in one reply. If they ask for several, do the first and offer the next.

Language: Swedish, unless they write to you in something else. Write the way a person texts: short lines, no filler. No markdown, no headings, no bullet characters, no LaTeX, no emoji. Maths typed the way it is on a phone: 2x + 3 = 11, x^2, (a+b)/2.`;

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
  /**
   * The photos themselves, shown to the model as pictures.
   *
   * Reading a page into text loses exactly what an exercise is made of:
   * which number is (a) and which is (b), the fraction bars, the figure. The
   * text is what finds the right pages; the picture is what gets answered.
   */
  files?: DownloadedAttachment[];
  client?: Anthropic;
  model?: string;
  /** How many pages of the book to put in front of the model. */
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
  const pinned = input.pinned ?? [];
  const files = input.files ?? [];

  if (input.pages.length === 0 && pinned.length === 0 && files.length === 0) {
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

  const found = choosePages(input, pinned);

  const content: Anthropic.ContentBlockParam[] = [];
  if (files.length > 0) {
    content.push({
      type: 'text',
      text: 'What the student photographed. This is the exercise they are asking about — read it here:',
    });
    for (const file of files) content.push(toModelContentBlock(file));
  }
  content.push({
    type: 'text',
    text: pagesAndConversation(input, found, pinned),
  });

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
      messages: [{ role: 'user', content }],
    },
  );

  // Claiming a page that was never offered is not something to trust
  // (docs/RULES.md §3.5), so the flag follows what retrieval actually found.
  const offered = new Set(found.map((page) => page.label));
  const usedPages = parsed.usedPages.filter((label) => offered.has(label));

  return {
    // A photo of their own book is material too, so a question answered off
    // the picture alone is still grounded.
    covered: parsed.covered && (found.length > 0 || files.length > 0),
    answer: formatAnswer(parsed),
    usedPages,
    consideredPages: found.map((page) => page.label),
    promptVersion: TUTOR_PROMPT_VERSION,
    model,
  };
}

/**
 * Which pages of the book to put in front of the model.
 *
 * Two searches, not one. What the student typed finds pages by name, and for a
 * question like "hur löser jag första frågan" that is nothing at all. What is
 * printed on the page they photographed — the exercise wording, the terms, the
 * numbers — finds the pages that teach it. Neither is allowed to crowd the
 * other out, so the two rankings are taken in turns.
 */
function choosePages(
  input: TutorInput,
  pinned: SearchablePage[],
): SearchablePage[] {
  const limit = input.pageLimit ?? DEFAULT_PAGE_LIMIT;

  // Search on the question plus what was just said, so a follow-up like
  // "och sen då?" still finds the page the conversation is about.
  const recent = (input.history ?? [])
    .slice(-4)
    .map((entry) => entry.text)
    .join(' ');
  const byQuestion = searchPages(
    input.pages,
    `${input.question} ${recent}`,
    limit,
  );

  const photographed = pinned
    .map((page) => `${page.label} ${page.text}`)
    .join(' ');
  const byPhoto =
    photographed.trim() === ''
      ? []
      : searchPages(input.pages, photographed, limit);

  const chosen: SearchablePage[] = [];
  const seen = new Set<string>();
  for (const page of [...pinned, ...interleave(byQuestion, byPhoto)]) {
    if (seen.has(page.id)) continue;
    seen.add(page.id);
    chosen.push(page);
    if (chosen.length >= limit + pinned.length) break;
  }
  return chosen;
}

/** Alternates two ranked lists so neither one crowds the other out. */
function interleave<T>(first: T[], second: T[]): T[] {
  const merged: T[] = [];
  for (let i = 0; i < Math.max(first.length, second.length); i += 1) {
    if (i < first.length) merged.push(first[i]!);
    if (i < second.length) merged.push(second[i]!);
  }
  return merged;
}

function pagesAndConversation(
  input: TutorInput,
  found: SearchablePage[],
  pinned: SearchablePage[],
): string {
  return [
    "Pages from the student's textbook:",
    found.length > 0
      ? found.map((page) => `--- ${page.label} ---\n${page.text}`).join('\n\n')
      : '(nothing in the book matched this question)',
    '',
    // Names only, not contents. Knowing which pages exist is what turns "not
    // in your book" into "s. 40-71 are read in, that one is not — photograph
    // it", and the difference between those two is whether the student can do
    // anything about it.
    'Every page that has been read in, by name. This list is all of it:',
    catalogue(input, pinned),
    '',
    'The conversation so far:',
    (input.history ?? [])
      .map(
        (entry) =>
          `${entry.role === 'companion' ? 'You' : 'Student'}: ${entry.text}`,
      )
      .join('\n'),
    `Student: ${input.question}`,
  ].join('\n');
}

/**
 * Assembles the parts into what the student reads.
 *
 * Blank lines between the parts and one numbered line per step is the whole
 * trick: it survives Telegram, iMessage and a terminal alike, because it is
 * nothing but line breaks.
 */
function formatAnswer(parsed: z.infer<typeof tutorOutputSchema>): string {
  const blocks: string[] = [];

  const exercise = parsed.exercise?.trim();
  if (exercise) blocks.push(exercise);

  blocks.push(parsed.message.trim());

  const steps = parsed.steps
    .map((step) => step.trim())
    .filter((step) => step !== '');
  if (steps.length > 0) {
    blocks.push(steps.map((step, index) => `${index + 1}. ${step}`).join('\n'));
  }

  const question = parsed.question?.trim();
  if (question) blocks.push(question);

  return blocks.join('\n\n');
}

/** How much of the page list to send. Names are short; a whole book still fits. */
const CATALOGUE_LIMIT = 300;

/** The names of every page the student has read in, retrieved or not. */
function catalogue(input: TutorInput, pinned: SearchablePage[]): string {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const page of [...pinned, ...input.pages]) {
    if (seen.has(page.id)) continue;
    seen.add(page.id);
    labels.push(page.label);
  }
  if (labels.length === 0) return '(nothing read in yet)';
  if (labels.length <= CATALOGUE_LIMIT) return labels.join(', ');
  return `${labels.slice(0, CATALOGUE_LIMIT).join(', ')} and ${labels.length - CATALOGUE_LIMIT} more`;
}
