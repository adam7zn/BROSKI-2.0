export interface AppErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  traceId: string;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly payload: AppErrorPayload,
  ) {
    super(payload.message);
    this.name = 'AppError';
  }
}
