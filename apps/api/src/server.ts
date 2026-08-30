import type { Server } from 'node:http';

import { jsonLogger } from './logger.js';
import { createConfiguredDemoApp } from './persistence.js';

const port = parsePort(process.env.PORT);
const host = process.env.HOST ?? '127.0.0.1';

void main().catch(() => {
  jsonLogger.write({
    level: 'error',
    event: 'api.start_failed',
    traceId: 'startup',
    status: 500,
    code: 'API_START_FAILED',
  });
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const runtime = await createConfiguredDemoApp();

  try {
    await listen(runtime.server, port, host);
    runtime.messagingWorker?.start();
  } catch (error) {
    await runtime.close();
    throw error;
  }

  jsonLogger.write({
    level: 'info',
    event: 'api.started',
    traceId: 'startup',
    status: 200,
  });
  process.stdout.write(
    `${JSON.stringify({
      event: 'api.listening',
      host,
      port,
      contracts: runtime.contracts.source,
      persistence: runtime.persistence,
    })}\n`,
  );

  let shutdown: Promise<void> | undefined;
  const stop = (signal: NodeJS.Signals): void => {
    shutdown ??= shutdownRuntime(runtime.server, runtime.close, signal);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function shutdownRuntime(
  server: Server,
  closePersistence: () => Promise<void>,
  signal: NodeJS.Signals,
): Promise<void> {
  jsonLogger.write({
    level: 'info',
    event: 'api.stopping',
    traceId: 'shutdown',
    code: signal,
  });

  let failed = false;

  try {
    await closeServer(server);
  } catch {
    failed = true;
  }

  try {
    await closePersistence();
  } catch {
    failed = true;
  }

  if (!failed) {
    jsonLogger.write({
      level: 'info',
      event: 'api.stopped',
      traceId: 'shutdown',
      status: 200,
    });
  } else {
    jsonLogger.write({
      level: 'error',
      event: 'api.stop_failed',
      traceId: 'shutdown',
      status: 500,
      code: 'API_STOP_FAILED',
    });
    process.exitCode = 1;
  }
}

function listen(
  server: Server,
  listenPort: number,
  listenHost: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(listenPort, listenHost, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return parsed;
}
