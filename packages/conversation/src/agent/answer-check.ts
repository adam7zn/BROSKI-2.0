/**
 * Deterministic answer checking.
 *
 * `docs/RULES.md` §3.2 prefers a deterministic mathematics check wherever it is
 * reliable. This module is deliberately narrow: it only reports a verdict for
 * cases it can decide on its own, and returns `unknown` for everything else so
 * the model evaluator decides instead.
 */

export type DeterministicVerdict = 'match' | 'mismatch' | 'unknown';

const NUMERIC_TOLERANCE = 1e-9;

/** Prefixes a student naturally types in front of a bare answer. */
const ANSWER_PREFIXES = [
  /^[a-z]\s*=\s*/, // "x = 4"
  /^svar(et)?\s*(är|:)?\s*/, // "svar: 4", "svaret är 4"
  /^answer\s*(is|:)?\s*/,
];

export function normalizeAnswer(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/[.!?\s]+$/, '');
  // A Swedish keyboard produces "4,5"; treat it as a decimal separator only
  // when it sits between digits, so answer lists like "2, 3" stay intact.
  value = value.replace(/(\d),(\d)/g, '$1.$2');
  value = value.replace(/\s+/g, ' ');
  for (const prefix of ANSWER_PREFIXES) {
    value = value.replace(prefix, '');
  }
  return value.trim();
}

/** Parses integers, decimals, and simple `a/b` fractions. Nothing else. */
export function toNumber(value: string): number | null {
  const compact = value.replace(/\s+/g, '');
  if (/^[+-]?\d+(\.\d+)?$/.test(compact)) {
    return Number(compact);
  }
  const fraction = /^([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)$/.exec(compact);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return numerator / denominator;
  }
  return null;
}

/**
 * Compares a reply with the expected answer.
 *
 * A `mismatch` is only reported when both sides are numbers — two different
 * strings can still be the same mathematics ("2(x+1)" vs "2x+2"), and this
 * checker is not entitled to call that wrong.
 */
export function checkAnswer(
  expectedAnswer: string | null,
  studentReply: string,
): DeterministicVerdict {
  if (expectedAnswer === null) return 'unknown';

  const expected = normalizeAnswer(expectedAnswer);
  const actual = normalizeAnswer(studentReply);
  if (expected === '' || actual === '') return 'unknown';
  if (expected === actual) return 'match';

  const expectedNumber = toNumber(expected);
  const actualNumber = toNumber(actual);
  if (expectedNumber === null || actualNumber === null) return 'unknown';

  return Math.abs(expectedNumber - actualNumber) <= NUMERIC_TOLERANCE
    ? 'match'
    : 'mismatch';
}
