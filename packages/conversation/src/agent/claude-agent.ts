import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { normaliseDifficulty, type BackendContext } from '../contracts.js';
import { checkAnswer, type DeterministicVerdict } from './answer-check.js';
import {
  MUST_RESOLVE_NOTE,
  NO_MORE_HINTS_NOTE,
  QUESTION_PROMPT_VERSION,
  RESPOND_PROMPT_VERSION,
  RESPOND_SYSTEM_PROMPT,
  questionSystemPrompt,
} from './prompts.js';
import {
  MAX_HINTS,
  MIN_CONFIDENCE,
  type AgentTurn,
  type GeneratedQuestion,
  type RespondInput,
  type StudyAgent,
  type TranscriptEntry,
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

const turnOutputSchema = z.object({
  intent: z.enum(['hint', 'clarify', 'feedback']),
  message: z.string().min(1),
  result: z
    .enum(['correct', 'partially_correct', 'incorrect', 'unclear'])
    .nullable(),
  confidence: z.number().min(0).max(1),
});

export class ModelOutputError extends Error {
  constructor(step: 'askQuestion' | 'respond', cause?: unknown) {
    super(`The model returned no schema-valid output for ${step}.`);
    this.name = 'ModelOutputError';
    this.cause = cause;
  }
}

export interface ClaudeStudyAgentOptions {
  client?: Anthropic;
  model?: string;
}

/** The study agent backed by Claude. */
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
      system: questionSystemPrompt(context.mode),
      output_config: {
        effort: 'low',
        format: zodOutputFormat(questionOutputSchema),
      },
      messages: [
        {
          role: 'user',
          content: [
            `Topic: ${context.topic}`,
            `Difficulty: ${normaliseDifficulty(context.difficulty)}`,
            context.reason ? `Why now: ${context.reason}` : '',
            'Course material:',
            context.sourceText,
          ]
            .filter(Boolean)
            .join('\n'),
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

  async respond(input: RespondInput): Promise<AgentTurn> {
    const latest = input.transcript.at(-1);
    const verdict = checkAnswer(
      input.question.expectedAnswer,
      latest?.text ?? '',
    );
    const hintsSpent = input.hintsGiven >= MAX_HINTS;

    const response = await this.#client.messages.parse({
      model: this.#model,
      max_tokens: 4000,
      system: [
        RESPOND_SYSTEM_PROMPT,
        input.canContinue ? '' : MUST_RESOLVE_NOTE,
        input.canContinue && hintsSpent ? NO_MORE_HINTS_NOTE : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      output_config: {
        effort: 'medium',
        format: zodOutputFormat(turnOutputSchema),
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
            `Hints already given: ${input.hintsGiven}`,
            `Deterministic checker on his latest message: ${describeVerdict(verdict)}`,
            '',
            'The conversation so far:',
            renderTranscript(input.transcript),
          ].join('\n'),
        },
      ],
    });

    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      throw new ModelOutputError('respond');
    }

    let { intent, result, confidence } = parsed;

    // A message that literally matches the expected answer is an answer,
    // whatever the model made of it (docs/RULES.md §3.2).
    if (verdict === 'match') {
      intent = 'feedback';
      result = 'correct';
      confidence = 1;
    } else if (verdict === 'mismatch' && result === 'correct') {
      result = 'incorrect';
      confidence = 1;
    }

    if (!input.canContinue) intent = 'feedback';
    const status = intent === 'feedback' ? 'resolved' : 'waiting';

    if (status === 'resolved') {
      // Below the threshold the agent reports uncertainty instead of a verdict
      // (docs/RULES.md §3.7) — a low-confidence guess must not become evidence.
      result =
        result === null ||
        (verdict === 'unknown' && confidence < MIN_CONFIDENCE)
          ? 'unclear'
          : result;
    } else {
      result = null;
    }

    return {
      intent,
      message: parsed.message.trim(),
      status,
      result,
      confidence,
      deterministic: verdict !== 'unknown',
      meta: {
        agent: 'claude',
        promptVersion: RESPOND_PROMPT_VERSION,
        model: this.#model,
      },
    };
  }
}

function renderTranscript(transcript: TranscriptEntry[]): string {
  return transcript
    .map(
      (entry) =>
        `${entry.role === 'companion' ? 'You' : 'William'}: ${entry.text}`,
    )
    .join('\n');
}

function describeVerdict(verdict: DeterministicVerdict): string {
  switch (verdict) {
    case 'match':
      return 'it matches the expected answer exactly. He is right.';
    case 'mismatch':
      return 'it is a number, and not the expected one. He is not right.';
    case 'unknown':
      return 'no verdict — decide for yourself.';
  }
}
