import { normaliseDifficulty, type BackendContext } from '../contracts.js';
import { checkAnswer } from './answer-check.js';
import {
  MAX_HINTS,
  type AgentTurn,
  type GeneratedQuestion,
  type RespondInput,
  type StudyAgent,
} from './types.js';

const META = {
  agent: 'scripted',
  promptVersion: 'scripted/2026-08-28.2',
  model: null,
} as const;

/** Phrases that mean "I need help" rather than "here is my answer". */
const STUCK = [
  'hint',
  'ledtråd',
  'tips',
  'hjälp',
  'help',
  'vet inte',
  'vet ej',
  'ingen aning',
  'fattar inte',
  'förstår inte',
  'kan inte',
  '?',
];

/**
 * A deterministic stand-in for the model-backed agent.
 *
 * It exists so the whole loop — messaging, hints, correlation, storage — can be
 * run and tested without network access or an API key (`docs/RULES.md` §6.3).
 * It generates a linear equation with a known integer solution whatever the
 * topic says, so it is a fixture, not a study agent. Never point a real student
 * at it.
 */
export class ScriptedStudyAgent implements StudyAgent {
  async askQuestion(context: BackendContext): Promise<GeneratedQuestion> {
    const seed = hash(context.interactionId);
    const a = 2 + (seed % 4); // 2..5
    const x = 2 + ((seed >>> 3) % 5); // 2..6
    const b = 1 + ((seed >>> 6) % 7); // 1..7

    const difficulty = normaliseDifficulty(context.difficulty);
    const question =
      difficulty === 'hard'
        ? `Solve ${a}x + ${b} = ${a - 1}x + ${x + b}.`
        : difficulty === 'medium'
          ? `Solve ${a}(x + ${b}) = ${a * (x + b)}.`
          : `Solve ${a}x + ${b} = ${a * x + b}.`;

    return {
      question,
      expectedAnswer: String(x),
      rubric: `A correct reply gives x = ${x}, however it is written.`,
      meta: { ...META },
    };
  }

  async respond(input: RespondInput): Promise<AgentTurn> {
    const latest = input.transcript.at(-1)?.text ?? '';
    const expected = input.question.expectedAnswer ?? '?';
    const verdict = checkAnswer(input.question.expectedAnswer, latest);

    if (verdict === 'match') {
      return turn('feedback', `Correct — x = ${expected}.`, 'correct', 1, true);
    }

    if (verdict === 'mismatch') {
      return turn(
        'feedback',
        `Not quite — x = ${expected}. Undo the addition first, then the multiplication.`,
        'incorrect',
        1,
        true,
      );
    }

    const asksForHelp = STUCK.some((phrase) =>
      latest.toLowerCase().includes(phrase),
    );

    if (input.canContinue && asksForHelp && input.hintsGiven < MAX_HINTS) {
      const hint =
        input.hintsGiven === 0
          ? 'Start by getting the number away from the x-term — do the same thing on both sides.'
          : 'Now you have something times x on its own. Divide both sides by that number.';
      return turn('hint', hint, null, 0.5, false);
    }

    if (input.canContinue) {
      return turn(
        'clarify',
        'I could not read that as an answer. What did you get for x?',
        null,
        0.3,
        false,
      );
    }

    return turn(
      'feedback',
      `Let's leave it there — x = ${expected}. Subtract first, then divide.`,
      'unclear',
      0.3,
      false,
    );
  }
}

function turn(
  intent: AgentTurn['intent'],
  message: string,
  result: AgentTurn['result'],
  confidence: number,
  deterministic: boolean,
): AgentTurn {
  return {
    intent,
    message,
    status: intent === 'feedback' ? 'resolved' : 'waiting',
    result,
    confidence,
    deterministic,
    meta: { ...META },
  };
}

/** FNV-1a, so the same interaction always produces the same question. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
