/**
 * Finds the pages of the student's own book that a question is about.
 *
 * Deliberately a keyword score rather than embeddings: the whole index is one
 * chapter of one book, it has to run with no network, and a scoring rule can be
 * read and argued with when it picks the wrong page.
 */

export interface SearchablePage {
  id: string;
  label: string;
  text: string;
}

export interface RetrievedPage extends SearchablePage {
  score: number;
}

/** Swedish and English words that say nothing about which page to look at. */
const STOP_WORDS = new Set([
  'och',
  'att',
  'det',
  'som',
  'en',
  'ett',
  'på',
  'är',
  'för',
  'med',
  'den',
  'de',
  'till',
  'av',
  'jag',
  'du',
  'han',
  'hon',
  'vi',
  'hur',
  'vad',
  'var',
  'när',
  'vilken',
  'vilket',
  'vilka',
  'kan',
  'ska',
  'skulle',
  'har',
  'hade',
  'inte',
  'man',
  'om',
  'så',
  'men',
  'eller',
  'där',
  'här',
  'detta',
  'denna',
  'vara',
  'blir',
  'göra',
  'gör',
  'får',
  'fram',
  'mig',
  'min',
  'mitt',
  'the',
  'and',
  'is',
  'are',
  'an',
  'of',
  'to',
  'in',
  'for',
  'on',
  'how',
  'what',
  'why',
  'this',
  'that',
  'it',
  'be',
  'can',
  'do',
  'does',
  'with',
  'my',
  'me',
  'you',
]);

export function tokenise(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}^-]+/u)
    .map((word) => word.replace(/^-+|-+$/g, '').trim())
    .filter((word) => word !== '');

  const tokens: string[] = [];
  for (const word of words) {
    // A hyphenated term is one thing and also its parts: "pq-formeln" has to
    // survive whole, because that is what makes it a rare, telling word — but
    // "formeln" alone should still match a page that spells it out.
    if (word.includes('-')) {
      if (keep(word)) tokens.push(word);
      for (const part of word.split('-')) {
        if (keep(part)) tokens.push(part);
      }
      continue;
    }
    if (keep(word)) tokens.push(word);
  }
  return tokens;
}

function keep(word: string): boolean {
  return word.length > 2 && !STOP_WORDS.has(word);
}

/**
 * Whether a page word answers to a query term.
 *
 * Swedish builds compounds, so a page that says "andragradsekvationer" is
 * talking about "ekvationer" and has to count for it — at less than a direct
 * hit, so an exact match still wins.
 */
function matchStrength(term: string, word: string): number {
  if (word === term) return 1;
  if (term.length >= 5 && word.includes(term)) return 0.5;
  if (word.length >= 5 && term.includes(word)) return 0.5;
  return 0;
}

/**
 * Scores each page against the question.
 *
 * A word that appears on few pages counts for more than one that appears on
 * every page, so "pq-formeln" outweighs "ekvation" in a chapter about
 * equations.
 */
export function searchPages(
  pages: SearchablePage[],
  query: string,
  limit = 3,
): RetrievedPage[] {
  const terms = new Set(tokenise(query));
  if (terms.size === 0 || pages.length === 0) return [];

  const tokenised = pages.map((page) => ({
    page,
    words: new Set(tokenise(`${page.label} ${page.text}`)),
  }));

  // How many pages each term touches at all, so a word on every page counts
  // for little and a word on one page counts for a lot.
  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    let seen = 0;
    for (const { words } of tokenised) {
      if ([...words].some((word) => matchStrength(term, word) > 0)) seen += 1;
    }
    documentFrequency.set(term, seen);
  }

  const scored: RetrievedPage[] = [];
  for (const { page, words } of tokenised) {
    let score = 0;
    for (const term of terms) {
      const strength = Math.max(
        0,
        ...[...words].map((word) => matchStrength(term, word)),
      );
      if (strength === 0) continue;
      const frequency = documentFrequency.get(term) ?? 1;
      score += strength * Math.log(1 + pages.length / frequency);
    }
    if (score > 0) scored.push({ ...page, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
