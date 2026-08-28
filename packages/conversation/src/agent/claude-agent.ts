import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { BackendContext } from '../contracts.js';
import { checkAnswer, type DeterministicVerdict } from './answer-check.js';
import {
  EVALUATION_PROMPT_VERSION,
  EVALUATION_SYSTEM_PROMPT,
  QUESTION_PROMPT_VERSION,
  QUESTION_SYSTEM_PROMPT,
} from './prompts.js';
import {
  MIN_CONFIDENCE,
  type EvaluateInput,
  type EvaluatedReply,
  type GeneratedQuestion,
  type StudyAgent,
} from './types.js';

export const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Model output shapes. `docs/RULES.md` §3.1: model output is untrusted until it
 * passes a runtime schema, so these schemas are the only way a model response
 * enters the rest of the package.
 */
const questionOutputSchema = z.object({
  question: z.string().min(1),
  expectedAnswer: z.string().nullable(),
  rubric: z.string().min(1),
});

const evaluationOutputSchema = z.object({
  result: z.enum(['correct', 'partially_correct', 'incorrect', 'unclear']),
  feedback: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export class ModelOutputError extends Error {
  constructor(step: 'askQuestion' | 'evaluate', cause?: unknown) {
    super(`The model returned no schema-valid output for ${step}.`);
    this.name = 'ModelOutputError';
    this.cause = cause;
  }
}

export interface ClaudeStudyAgentOptions {
  client?: Anthropic;
  model?: string;
}

/**
 * The study agent backed by Claude.
 *
 * It stays deliberately small (Phase 1): one question, one evaluation. No
 * tools, no retrieval, no memory, no follow-up turn.
 */
export class ClaudeStudyAgent implements StudyAgent {
  readonly #client: Anthropic;
  readonly #model: string;

  constructor(options: ClaudeStudyAgentOptions = {}) {
    this.#client =
      options.client ??
      // Credentials come from the environment; never from a repository file
      // (docs/RULES.md §5.7).
      new Anthropic({ maxRetries: 3, timeout: 60_000 });
    this.#model = options.model ?? process.env['MSC_MODEL'] ?? DEFAULT_MODEL;
  }

  async askQuestion(context: BackendContext): Promise<GeneratedQuestion> {
    const response = await this.#client.messages.parse({
      model: this.#model,
      max_tokens: 2000,
      system: QUESTION_SYSTEM_PROMPT,
      output_config: {
        effort: 'low',
        format: zodOutputFormat(questionOutputSchema),
      },
      messages: [
        {
          role: 'user',
          content: [
            `Topic: ${context.topic}`,
            `Difficulty: ${context.difficulty}`,
            'Course material:',
            context.sourceText,
          ].join('\n'),
        },
      ],
    });

    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      throw new ModelOutputError('askQuestion');
    }

    return {
      question: parsed.question.trim(),
      expectedAnswer: parsed.expectedAnswer?.trim() || null,
      rubric: parsed.rubric.trim(),
      meta: {
        agent: 'claude',
        promptVersion: QUESTION_PROMPT_VERSION,
        model: this.#model,
      },
    };
  }

  async evaluate(input: EvaluateInput): Promise<EvaluatedReply> {
    const verdict = checkAnswer(
      input.question.expectedAnswer,
      input.studentReply,
    );

    const response = await this.#client.messages.parse({
      model: this.#model,
      max_tokens: 4000,
      system: EVALUATION_SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: zodOutputFormat(evaluationOutputSchema),
      },
      messages: [
        {
          role: 'user',
          content: [
            'Course material:',
            input.context.sourceText,
            '',
            `Question asked: ${input.question.question}`,
            `Expected answer: ${input.question.expectedAnswer ?? '(none — judge by rubric)'}`,
            `Rubric: ${input.question.rubric}`,
            `Deterministic checker: ${describeVerdict(verdict)}`,
            '',
            'His reply, exactly as sent:',
            input.studentReply,
          ].join('\n'),
        },
      ],
    });

    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      throw new ModelOutputError('evaluate');
    }

    // The deterministic check wins on correctness where it has an opinion
    // (docs/RULES.md §3.2); the model still supplies the wording.
    let result = parsed.result;
    let confidence = parsed.confidence;
    if (verdict === 'match') {
      result = 'correct';
      confidence = 1;
    } else if (verdict === 'mismatch' && result === 'correct') {
      result = 'incorrect';
      confidence = 1;
    }

    // Below the threshold the agent reports uncertainty instead of a verdict
    // (docs/RULES.md §3.7) — a low-confidence guess must not become evidence.
    if (verdict === 'unknown' && confidence < MIN_CONFIDENCE) {
      result = 'unclear';
    }

    return {
      result,
      feedback: parsed.feedback.trim(),
      confidence,
      deterministic: verdict !== 'unknown',
      meta: {
        agent: 'claude',
        promptVersion: EVALUATION_PROMPT_VERSION,
        model: this.#model,
      },
    };
  }
}

function describeVerdict(verdict: DeterministicVerdict): string {
  switch (verdict) {
    case 'match':
      return 'the reply matches the expected answer exactly. The result is correct.';
    case 'mismatch':
      return 'the reply is a number and it is not the expected one. The result is not correct.';
    case 'unknown':
      return 'no verdict — decide for yourself.';
  }
}
