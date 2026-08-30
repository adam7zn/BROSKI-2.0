export type AnswerVerdict = 'correct' | 'incorrect' | 'unclear';

export function checkCanonicalAnswer(reply: string): AnswerVerdict {
  const normalized = reply.toLowerCase().replaceAll(' ', '').replace(/^x=/, '');
  const value = parseNumericExpression(normalized);
  if (value === null) return 'unclear';
  return value === 4 ? 'correct' : 'incorrect';
}

function parseNumericExpression(value: string): number | null {
  if (/^[-+]?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const fraction = value.match(/^([-+]?\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)$/);
  if (!fraction) return null;
  const numerator = Number(fraction[1]);
  const denominator = Number(fraction[2]);
  return denominator === 0 ? null : numerator / denominator;
}
