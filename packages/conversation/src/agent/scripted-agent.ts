import type { BackendContext } from '../contracts.js';
import { checkAnswer } from './answer-check.js';
import {
  type EvaluateInput,
  type EvaluatedReply,
  type GeneratedQuestion,
  type StudyAgent,
} from './types.js';

/**
 * A deterministic stand-in for the model-backed agent.
 *
 * It exists so the whole loop — messaging, correlation, storage — can be run
 * and tested without network access or an API key (`docs/RULES.md` §6.3). It
 * generates a linear equation with a known integer solution, whatever the topic
 * says, so it is a fixture, not a study agent. Never point a real student at it.
 */
export class ScriptedStudyAgent implements StudyAgent {
  async askQuestion(context: BackendContext): Promise<GeneratedQuestion> {
    const seed = hash(context.interactionId);
    const a = 2 + (seed % 4); // 2..5
    const x = 2 + ((seed >>> 3) % 5); // 2..6
    const b = 1 + ((seed >>> 6) % 7); // 1..7

    const question =
      context.difficulty === 'hard'
        ? `Solve ${a}x + ${b} = ${a - 1}x + ${x + b}.`
        : context.difficulty === 'medium'
          ? `Solve ${a}(x + ${b}) = ${a * (x + b)}.`
          : `Solve ${a}x + ${b} = ${a * x + b}.`;

    return {
      question,
      expectedAnswer: String(x),
      rubric: `A correct reply gives x = ${x}, however it is written.`,
      meta: {
        agent: 'scripted',
        promptVersion: 'scripted/2026-08-28.1',
        model: null,
      },
    };
  }

  async evaluate(input: EvaluateInput): Promise<EvaluatedReply> {
    const verdict = checkAnswer(
      input.question.expectedAnswer,
      input.studentReply,
    );
    const expected = input.question.expectedAnswer ?? '?';

    if (verdict === 'match') {
      return this.#reply('correct', `Correct — x = ${expected}.`, 1, true);
    }
    if (verdict === 'mismatch') {
      return this.#reply(
        'incorrect',
        `Not quite — the answer is x = ${expected}. Undo the addition first, then the multiplication.`,
        1,
        true,
      );
    }
    return this.#reply(
      'unclear',
      'I could not read that as an answer. What did you get for x?',
      0.3,
      false,
    );
  }

  #reply(
    result: EvaluatedReply['result'],
    feedback: string,
    confidence: number,
    deterministic: boolean,
  ): EvaluatedReply {
    return {
      result,
      feedback,
      confidence,
      deterministic,
      meta: {
        agent: 'scripted',
        promptVersion: 'scripted/2026-08-28.1',
        model: null,
      },
    };
  }
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
