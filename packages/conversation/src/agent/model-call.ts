import Anthropic from '@anthropic-ai/sdk';

/**
 * One place where every model call goes out.
 *
 * A failing model call must never take the process down: the student is in the
 * middle of a conversation, and "something broke" said out loud beats a stack
 * trace nobody sees.
 */
export class ModelCallError extends Error {
  constructor(
    readonly step: string,
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(
      `Model call "${step}" failed${status ? ` (${status})` : ''}: ${detail}`,
    );
    this.name = 'ModelCallError';
  }

  /** What to say to the student. Never the API's words. */
  get studentMessage(): string {
    if (this.status === 401 || this.status === 403) {
      return 'Jag kommer inte åt min hjärna just nu — nyckeln verkar fel. Säg till den som satte upp mig.';
    }
    if (this.status === 429) {
      return 'Jag är överbelastad just nu. Prova igen om en stund.';
    }
    return 'Något gick fel hos mig just nu. Prova igen om en liten stund.';
  }
}

type ParseParams = Parameters<Anthropic['messages']['parse']>[0];

/**
 * Runs a structured call and returns the parsed output.
 *
 * `output_config.effort` is dropped and the call retried once if the API
 * rejects the request with it: effort and structured output are both current
 * features, and a deployment that has one but not the other should degrade to a
 * slightly more expensive call rather than fail outright.
 */
export async function parseStructured<T>(
  client: Anthropic,
  step: string,
  params: ParseParams,
): Promise<T> {
  let response;
  try {
    response = await client.messages.parse(params);
  } catch (error) {
    const status = statusOf(error);
    const hasEffort =
      params.output_config !== undefined && 'effort' in params.output_config;

    if (status === 400 && hasEffort) {
      const withoutEffort = {
        ...(params.output_config as Record<string, unknown>),
      };
      delete withoutEffort['effort'];
      try {
        response = await client.messages.parse({
          ...params,
          output_config: withoutEffort,
        } as ParseParams);
      } catch (retryError) {
        throw asModelCallError(step, retryError);
      }
    } else {
      throw asModelCallError(step, error);
    }
  }

  const parsed = (response as unknown as { parsed_output?: T }).parsed_output;
  if (parsed === null || parsed === undefined) {
    // Schema validation failed, so the response is not to be trusted at all
    // (docs/RULES.md §3.1).
    throw new ModelCallError(step, null, 'no schema-valid output');
  }
  return parsed;
}

function statusOf(error: unknown): number | null {
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    return error.status;
  }
  return null;
}

function asModelCallError(step: string, error: unknown): ModelCallError {
  if (error instanceof ModelCallError) return error;
  const status = statusOf(error);
  const detail =
    error instanceof Error ? error.message : String(error ?? 'unknown error');
  return new ModelCallError(step, status, detail);
}
