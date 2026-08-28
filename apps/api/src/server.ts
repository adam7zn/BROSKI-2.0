import { createDemoApp } from './app.js';
import { jsonLogger } from './logger.js';

const port = parsePort(process.env.PORT);
const host = process.env.HOST ?? '127.0.0.1';
const { server, contracts } = await createDemoApp();

server.listen(port, host, () => {
  jsonLogger.write({
    level: 'info',
    event: 'api.started',
    traceId: 'startup',
    status: 200,
  });
  process.stdout.write(
    `${JSON.stringify({ event: 'api.listening', host, port, contracts: contracts.source })}\n`,
  );
});

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return parsed;
}
