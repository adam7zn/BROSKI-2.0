import { SendblueMessagingProvider } from '@math-study-companion/conversation';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describeEnvKeys, readConfig, repoRoot } from './config.js';
import { SendblueInboundServer } from './sendblue-inbound.js';
import { serve } from './serve.js';

/**
 * The companion over iMessage, through Sendblue.
 *
 * Sendblue pushes inbound messages to a webhook rather than being polled, so
 * this opens a port and waits to be called. In a codespace, forward that port
 * publicly and give Sendblue the resulting URL.
 *
 * `MESSAGING_LIVE_ENABLED` must be `true` before anything reaches a real
 * phone — a wrong message to a real number is worse than no message at all
 * (`docs/RULES.md` §4.2).
 */
async function main(): Promise<void> {
  const config = readConfig();
  const { sendblue } = config;

  const missing = (
    [
      ['SENDBLUE_API_KEY_ID', sendblue.apiKeyId],
      ['SENDBLUE_API_SECRET_KEY', sendblue.apiSecretKey],
      ['SENDBLUE_FROM_NUMBER', sendblue.fromNumber],
      ['SENDBLUE_RECIPIENT_NUMBER', sendblue.recipientNumber],
      ['SENDBLUE_WEBHOOK_SECRET', sendblue.webhookSecret],
    ] as const
  )
    .filter(([, value]) => value === '')
    .map(([name]) => name);

  if (missing.length > 0) {
    // Say which file was read and what was in it: the usual cause is values
    // typed into .env.sendblue.example, which is a template and is never read.
    const envFile = resolve(repoRoot, '.env');
    console.error(
      `Missing in .env: ${missing.join(', ')}\n\n` +
        `Read ${envFile}\n` +
        `  that file ${existsSync(envFile) ? 'exists' : 'does not exist yet'}\n` +
        `  keys in it: ${describeEnvKeys() || '(none)'}\n\n` +
        'Values go in .env itself. .env.sendblue.example only documents the\n' +
        'names; nothing reads it. To copy the names across:\n' +
        '  grep SENDBLUE .env.sendblue.example >> .env',
    );
    process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());

  const messaging = new SendblueMessagingProvider({
    apiBaseUrl: sendblue.apiBaseUrl,
    apiKeyId: sendblue.apiKeyId,
    apiSecretKey: sendblue.apiSecretKey,
    fromNumber: sendblue.fromNumber,
    recipientNumber: sendblue.recipientNumber,
    liveEnabled: sendblue.liveEnabled,
  });

  const inbound = new SendblueInboundServer({
    port: sendblue.webhookPort,
    webhookSecret: sendblue.webhookSecret,
    recipientNumber: sendblue.recipientNumber,
    onDelivery: (event) =>
      console.log(`  delivery   ${event.providerMessageId} ${event.eventType}`),
  });

  await inbound.start();
  console.log(
    `Webhook listening on port ${sendblue.webhookPort} at /webhooks/sendblue.\n` +
      'Forward that port publicly and give Sendblue the URL, with the secret\n' +
      'as ?secret=<SENDBLUE_WEBHOOK_SECRET> or the sb-signing-secret header.',
  );
  if (!sendblue.liveEnabled) {
    console.log(
      '\nMESSAGING_LIVE_ENABLED is not true, so nothing will reach the phone.\n' +
        'Set it to true in .env when you actually want to send.',
    );
  }

  try {
    await serve({
      config,
      messaging,
      inbound,
      // Sendblue delivers media as URLs rather than files to fetch.
      downloader: null,
      conversationId: sendblue.recipientNumber,
      signal: controller.signal,
      stopAfterOne: process.argv.includes('--once'),
      force: process.argv.includes('--force'),
    });
  } finally {
    inbound.stop();
    controller.abort();
  }
}

await main();
