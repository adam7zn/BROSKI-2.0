export type AnswerVerdict = 'correct' | 'incorrect' | 'unclear';

export function checkCanonicalAnswer(reply: string): AnswerVerdict {
  const normalized = reply.toLowerCase().replaceAll(' ', '');
  if (/^(x=)?4(?:\.0+)?$/.test(normalized)) return 'correct';
  if (/^(x=)?[-+]?\d+(?:\.\d+)?$/.test(normalized)) return 'incorrect';
  return 'unclear';
}
