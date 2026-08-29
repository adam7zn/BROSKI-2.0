import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { demoInteractionIdSchema } from '@math-study-companion/contracts';

import { AppError, type AppErrorPayload } from './errors.js';
import type { Logger } from './logger.js';
import { jsonLogger } from './logger.js';
import type { DemoService } from './service.js';

const jsonBodyLimitBytes = 64 * 1024;

export interface DemoHttpServerOptions {
  service: DemoService;
  logger?: Logger;
}

export function createDemoHttpServer(options: DemoHttpServerOptions): Server {
  const logger = options.logger ?? jsonLogger;

  return createServer(async (request, response) => {
    const requestTraceId = traceIdFrom(request);
    let interactionId: string | undefined;

    try {
      const url = new URL(request.url ?? '/', 'http://internal');
      const path = url.pathname;
      const method = request.method ?? 'GET';

      if (method === 'GET' && path === '/health') {
        respond(response, 200, { status: 'ok' }, requestTraceId);
        log(
          logger,
          'info',
          'health.checked',
          requestTraceId,
          method,
          path,
          200,
        );
        return;
      }

      if (method === 'POST' && path === '/internal/demo/start') {
        const requestedInteractionId = url.searchParams.get('interactionId');
        if (
          requestedInteractionId !== null &&
          !demoInteractionIdSchema.safeParse(requestedInteractionId).success
        ) {
          throw new AppError(400, {
            code: 'INVALID_INTERACTION_ID',
            message: 'The requested interaction ID is invalid',
            retryable: false,
            traceId: requestTraceId,
          });
        }
        const interaction = await options.service.start(
          requestTraceId,
          requestedInteractionId ?? undefined,
        );
        interactionId = interaction.interactionId;
        respond(response, 201, interaction.context, interaction.traceId);
        log(
          logger,
          'info',
          'demo.started',
          interaction.traceId,
          method,
          path,
          201,
          interactionId,
        );
        return;
      }

      if (method === 'PUT' && path === '/internal/demo/profile') {
        const profile = await options.service.saveProfile(
          await readJson(request, requestTraceId),
          requestTraceId,
        );
        respond(response, 200, profile, profile.traceId);
        log(
          logger,
          'info',
          'demo.profile_saved',
          profile.traceId,
          method,
          path,
          200,
        );
        return;
      }

      if (method === 'GET' && path === '/internal/demo/profile') {
        const profile = await options.service.getProfile(requestTraceId);
        respond(response, 200, profile, profile.traceId);
        log(
          logger,
          'info',
          'demo.profile_retrieved',
          profile.traceId,
          method,
          path,
          200,
        );
        return;
      }

      if (method === 'GET' && path === '/internal/demo') {
        const interactions = await options.service.list();
        respond(response, 200, { interactions }, requestTraceId);
        log(logger, 'info', 'demo.listed', requestTraceId, method, path, 200);
        return;
      }

      const resultMatch = path.match(/^\/internal\/demo\/([^/]+)\/result$/);
      if (method === 'POST' && resultMatch?.[1]) {
        interactionId = decodeURIComponent(resultMatch[1]);
        const payload = await readJson(request, requestTraceId);
        const interaction = await options.service.submitResult(
          interactionId,
          payload,
          requestTraceId,
        );
        respond(response, 200, interaction, interaction.traceId);
        log(
          logger,
          'info',
          'demo.result_saved',
          interaction.traceId,
          method,
          path,
          200,
          interactionId,
        );
        return;
      }

      const reserveMatch = path.match(
        /^\/internal\/demo\/([^/]+)\/outbound\/reserve$/,
      );
      if (method === 'POST' && reserveMatch?.[1]) {
        interactionId = decodeURIComponent(reserveMatch[1]);
        const reservation = await options.service.reserveOutbound(
          interactionId,
          await readJson(request, requestTraceId),
          requestTraceId,
        );
        const status = reservation.outcome === 'reserved' ? 201 : 200;
        respond(
          response,
          status,
          { outcome: reservation.outcome },
          reservation.traceId,
        );
        log(
          logger,
          'info',
          `demo.outbound_${reservation.outcome}`,
          reservation.traceId,
          method,
          path,
          status,
          interactionId,
        );
        return;
      }

      const eventsMatch = path.match(/^\/internal\/demo\/([^/]+)\/events$/);
      if (eventsMatch?.[1]) {
        interactionId = decodeURIComponent(eventsMatch[1]);
        if (method === 'POST') {
          const recorded = await options.service.recordMessageEvent(
            interactionId,
            await readJson(request, requestTraceId),
            requestTraceId,
          );
          const traceId =
            recorded.outcome === 'recorded'
              ? recorded.event.traceId
              : recorded.traceId;
          const status = recorded.outcome === 'recorded' ? 201 : 200;
          respond(response, status, recorded, traceId);
          log(
            logger,
            'info',
            `demo.message_event_${recorded.outcome}`,
            traceId,
            method,
            path,
            status,
            interactionId,
          );
          return;
        }
        if (method === 'GET') {
          const listed = await options.service.listMessageEvents(
            interactionId,
            requestTraceId,
          );
          respond(response, 200, { events: listed.events }, listed.traceId);
          log(
            logger,
            'info',
            'demo.message_events_listed',
            listed.traceId,
            method,
            path,
            200,
            interactionId,
          );
          return;
        }
      }

      const getMatch = path.match(/^\/internal\/demo\/([^/]+)$/);
      if (method === 'GET' && getMatch?.[1]) {
        interactionId = decodeURIComponent(getMatch[1]);
        const interaction = await options.service.get(
          interactionId,
          requestTraceId,
        );
        respond(response, 200, interaction, interaction.traceId);
        log(
          logger,
          'info',
          'demo.retrieved',
          interaction.traceId,
          method,
          path,
          200,
          interactionId,
        );
        return;
      }

      throw new AppError(404, {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route not found',
        retryable: false,
        traceId: requestTraceId,
      });
    } catch (error) {
      const appError = toAppError(error, requestTraceId);
      respond(
        response,
        appError.status,
        appError.payload,
        appError.payload.traceId,
      );
      logger.write({
        level: appError.status >= 500 ? 'error' : 'warn',
        event: 'api.request_failed',
        traceId: appError.payload.traceId,
        ...(interactionId === undefined ? {} : { interactionId }),
        method: request.method ?? 'GET',
        path: safePath(request.url),
        status: appError.status,
        code: appError.payload.code,
      });
    }
  });
}

async function readJson(
  request: IncomingMessage,
  traceId: string,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    length += chunk.length;
    if (length > jsonBodyLimitBytes) {
      throw new AppError(413, {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'JSON request body exceeds 64 KiB',
        retryable: false,
        traceId,
      });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new AppError(400, {
      code: 'INVALID_JSON',
      message: 'Request body must be valid JSON',
      retryable: false,
      traceId,
    });
  }
}

function respond(
  response: ServerResponse,
  status: number,
  body: unknown,
  traceId: string,
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-trace-id': traceId,
  });
  response.end(JSON.stringify(body));
}

function traceIdFrom(request: IncomingMessage): string {
  const value = request.headers['x-trace-id'];
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)
    ? candidate
    : randomUUID();
}

function toAppError(error: unknown, traceId: string): AppError {
  if (error instanceof AppError) return error;

  return new AppError(500, {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected internal error occurred',
    retryable: false,
    traceId,
  });
}

function safePath(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? '/', 'http://internal').pathname;
  } catch {
    return '/';
  }
}

function log(
  logger: Logger,
  level: 'info' | 'warn' | 'error',
  event: string,
  traceId: string,
  method: string,
  path: string,
  status: number,
  interactionId?: string,
): void {
  logger.write({
    level,
    event,
    traceId,
    ...(interactionId === undefined ? {} : { interactionId }),
    method,
    path,
    status,
  });
}

export function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'retryable' in value &&
    'traceId' in value
  );
}
