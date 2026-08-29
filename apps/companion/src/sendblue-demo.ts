import { randomUUID } from 'node:crypto';

import { DemoApiClient } from './api-client.js';

export interface LaunchSendblueDemoOptions {
  apiUrl: string;
  internalApiToken: string;
  interactionId: string;
  traceId: string;
  fetchImplementation?: typeof fetch;
}

export async function launchSendblueDemo(
  options: LaunchSendblueDemoOptions,
): Promise<{ interactionId: string; traceId: string; status: 'queued' }> {
  const api = new DemoApiClient(
    options.apiUrl,
    options.traceId,
    options.fetchImplementation ?? fetch,
    options.internalApiToken,
  );
  await api.health();
  const context = await api.start(options.interactionId);
  await api.launch(context.interactionId);
  return {
    interactionId: context.interactionId,
    traceId: options.traceId,
    status: 'queued',
  };
}

if (isMainModule()) {
  const traceId = randomUUID();
  const interactionId = process.env['MSC_INTERACTION_ID'] ?? `judge-${traceId}`;
  launchSendblueDemo({
    apiUrl: requiredEnvironment('MSC_API_URL'),
    internalApiToken: requiredEnvironment('INTERNAL_API_TOKEN'),
    interactionId,
    traceId,
  }).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    () => {
      process.stderr.write(
        `${JSON.stringify({ status: 'failed', traceId, code: 'SENDBLUE_LAUNCH_FAILED' })}\n`,
      );
      process.exitCode = 1;
    },
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1]);
}
