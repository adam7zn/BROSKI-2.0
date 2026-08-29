import { randomUUID } from 'node:crypto';

import {
  IMessageCliProvider,
  ReplyInbox,
  runCanonicalInteraction,
  runOnboarding,
} from '@math-study-companion/conversation';

import { DemoApiClient } from './api-client.js';
import { RecordedMessagingProvider } from './recorded-messaging.js';

const traceId = randomUUID();
const abortController = new AbortController();
const apiUrl = process.env['MSC_API_URL'] ?? 'http://127.0.0.1:3000';
const recipient = requiredEnvironment('MSC_IMESSAGE_RECIPIENT');
const timeoutMs = positiveInteger('MSC_REPLY_TIMEOUT_MS', 120_000);
const pollIntervalMs = positiveInteger('MSC_IMESSAGE_POLL_MS', 1_000);
const requestedInteractionId =
  process.env['MSC_INTERACTION_ID'] ?? `judge-${traceId}`;

process.once('SIGINT', () => abortController.abort());
process.once('SIGTERM', () => abortController.abort());

const api = new DemoApiClient(apiUrl, traceId);
const provider = new IMessageCliProvider({
  binary: process.env['MSC_IMESSAGE_CLI'] ?? 'imessage-cli',
  recipient,
  pollIntervalMs,
});
let pump: Promise<void> | null = null;

try {
  await api.health();
  await provider.verify();
  const context = await api.start(requestedInteractionId);
  const messaging = new RecordedMessagingProvider(
    context.interactionId,
    provider,
    api,
  );
  const inbox = new ReplyInbox();
  pump = inbox.pump(messaging, abortController.signal);

  const profile = await withInboundPump(
    runOnboarding({
      interactionId: context.interactionId,
      conversationId: recipient,
      messaging,
      inbox,
      timeoutMs,
      signal: abortController.signal,
    }),
    pump,
  );
  await api.saveProfile(profile);

  const result = await withInboundPump(
    runCanonicalInteraction({
      context,
      conversationId: recipient,
      messaging,
      inbox,
      timeoutMs,
      signal: abortController.signal,
    }),
    pump,
  );
  await api.submitResult(context.interactionId, result);
  const saved = await api.retrieve(context.interactionId);
  const events = await api.listEvents(context.interactionId);

  console.log(
    JSON.stringify({
      status: 'completed',
      interactionId: context.interactionId,
      traceId,
      result: result.result,
      profileSaved: true,
      messageEvents: events.length,
      persisted: saved.interactionId === context.interactionId,
    }),
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown demo failure';
  console.error(JSON.stringify({ status: 'failed', traceId, message }));
  process.exitCode = 1;
} finally {
  abortController.abort();
  await pump?.catch(() => undefined);
}

async function withInboundPump<T>(
  operation: Promise<T>,
  inboundPump: Promise<void>,
): Promise<T> {
  return Promise.race([
    operation,
    inboundPump.then(() => {
      throw new Error('iMessage inbox stopped before the demo completed');
    }),
  ]);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
