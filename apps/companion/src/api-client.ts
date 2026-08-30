import {
  backendToConversationSchema,
  conversationToBackendSchema,
  demoMessageEventInputSchema,
  demoProfileInputSchema,
  type BackendToConversation,
  type ConversationToBackend,
  type DemoMessageEventInput,
  type DemoProfileInput,
} from '@math-study-companion/contracts';

export interface StoredEvent extends DemoMessageEventInput {
  id: string;
  interactionId: string;
  traceId: string;
  recordedAt: string;
}

export class DemoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly traceId: string,
    options?: ErrorOptions,
  ) {
    super(`Demo API request failed (${status} ${code})`, options);
    this.name = 'DemoApiError';
  }
}

export class DemoApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly traceId: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly internalApiToken?: string,
  ) {}

  async health(): Promise<void> {
    await this.#request('/health');
  }

  async start(interactionId?: string): Promise<BackendToConversation> {
    const query = interactionId
      ? `?interactionId=${encodeURIComponent(interactionId)}`
      : '';
    return backendToConversationSchema.parse(
      await this.#request(`/internal/demo/start${query}`, { method: 'POST' }),
    );
  }

  async saveProfile(profile: DemoProfileInput): Promise<void> {
    demoProfileInputSchema.parse(profile);
    await this.#request('/internal/demo/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    });
  }

  async reserveOutbound(
    interactionId: string,
    idempotencyKey: string,
  ): Promise<'reserved' | 'duplicate'> {
    const body = await this.#request(
      `/internal/demo/${encodeURIComponent(interactionId)}/outbound/reserve`,
      {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey }),
      },
    );
    if (
      !isRecord(body) ||
      (body.outcome !== 'reserved' && body.outcome !== 'duplicate')
    ) {
      throw new Error('API returned an invalid outbound reservation');
    }
    return body.outcome;
  }

  async recordEvent(
    interactionId: string,
    event: DemoMessageEventInput,
  ): Promise<'recorded' | 'duplicate'> {
    demoMessageEventInputSchema.parse(event);
    const body = await this.#request(
      `/internal/demo/${encodeURIComponent(interactionId)}/events`,
      { method: 'POST', body: JSON.stringify(event) },
    );
    if (
      !isRecord(body) ||
      (body.outcome !== 'recorded' && body.outcome !== 'duplicate')
    ) {
      throw new Error('API returned an invalid message-event outcome');
    }
    return body.outcome;
  }

  async listEvents(interactionId: string): Promise<StoredEvent[]> {
    const body = await this.#request(
      `/internal/demo/${encodeURIComponent(interactionId)}/events`,
    );
    if (!isRecord(body) || !Array.isArray(body.events)) {
      throw new Error('API returned an invalid event list');
    }
    return body.events as StoredEvent[];
  }

  async submitResult(
    interactionId: string,
    result: ConversationToBackend,
  ): Promise<void> {
    conversationToBackendSchema.parse(result);
    await this.#request(
      `/internal/demo/${encodeURIComponent(interactionId)}/result`,
      { method: 'POST', body: JSON.stringify(result) },
    );
  }

  async retrieve(interactionId: string): Promise<Record<string, unknown>> {
    const body = await this.#request(
      `/internal/demo/${encodeURIComponent(interactionId)}`,
    );
    if (!isRecord(body)) throw new Error('API returned an invalid interaction');
    return body;
  }

  async launch(interactionId: string): Promise<Record<string, unknown>> {
    const body = await this.#request(
      `/internal/demo/${encodeURIComponent(interactionId)}/launch`,
      { method: 'POST' },
    );
    if (!isRecord(body)) {
      throw new Error('API returned an invalid messaging session');
    }
    return body;
  }

  async inspectMessaging(
    interactionId: string,
  ): Promise<Record<string, unknown>> {
    const body = await this.#request(
      `/internal/demo/${encodeURIComponent(interactionId)}/messaging`,
    );
    if (!isRecord(body)) {
      throw new Error('API returned invalid messaging state');
    }
    return body;
  }

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    headers.set('content-type', 'application/json');
    headers.set('x-trace-id', this.traceId);
    if (path.startsWith('/internal/') && this.internalApiToken) {
      headers.set('authorization', `Bearer ${this.internalApiToken}`);
    }
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (error) {
      throw new DemoApiError(0, 'NETWORK_ERROR', true, this.traceId, {
        cause: error,
      });
    }
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const code =
        isRecord(body) && typeof body.code === 'string'
          ? body.code
          : 'HTTP_ERROR';
      const retryable =
        isRecord(body) && typeof body.retryable === 'boolean'
          ? body.retryable
          : response.status === 429 || response.status >= 500;
      throw new DemoApiError(
        response.status,
        code,
        retryable,
        returnedTraceId(body, response, this.traceId),
      );
    }
    if (body === null) {
      throw new DemoApiError(
        response.status,
        'INVALID_API_RESPONSE',
        false,
        returnedTraceId(body, response, this.traceId),
      );
    }
    return body;
  }
}

function returnedTraceId(
  body: unknown,
  response: Response,
  fallback: string,
): string {
  if (isRecord(body) && typeof body.traceId === 'string' && body.traceId) {
    return body.traceId;
  }
  return response.headers.get('x-trace-id') || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
