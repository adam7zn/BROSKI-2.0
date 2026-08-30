import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { TelegramMessagingProvider } from '@math-study-companion/conversation';

import { describeEnvKeys, readConfig, repoRoot } from './config.js';
import { serve } from './serve.js';

/**
 * The companion over Telegram.
 *
 * It keeps serving until stopped. `--once` answers a single message and exits;
 * `--force` asks a study question even when the planner would stay quiet.
 * Nothing is ever sent unprompted — scheduling and quiet hours belong to a
 * later phase (`docs/PHASES.md` Phase 5).
 */
async function main(): Promise<void> {
  const config = readConfig();

  if (!config.telegramToken) {
    console.error(
      'TELEGRAM_BOT_TOKEN is missing.\n\n' +
        `Looked in ${resolve(repoRoot, '.env')}\n` +
        `  that file ${existsSync(resolve(repoRoot, '.env')) ? 'exists' : 'does not exist yet'}\n` +
        `  keys found in it: ${describeEnvKeys() || '(none)'}\n\n` +
        'Create a bot with @BotFather, then write its token to .env like this:\n' +
        "  echo 'TELEGRAM_BOT_TOKEN=paste-the-token-here' > .env",
    );
    process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());

  if (!config.telegramChatId) {
    await discoverChatId(config.telegramToken, controller.signal);
    return;
  }

  const messaging = new TelegramMessagingProvider({
    token: config.telegramToken,
    allowedConversationIds: [config.telegramChatId],
  });

  await serve({
    config,
    messaging,
    inbound: messaging,
    downloader: messaging,
    conversationId: config.telegramChatId,
    signal: controller.signal,
    stopAfterOne: process.argv.includes('--once'),
    force: process.argv.includes('--force'),
  });
  controller.abort();
}

/** First-run helper: prints the chat id of whoever writes to the bot. */
async function discoverChatId(
  token: string,
  signal: AbortSignal,
): Promise<void> {
  console.log(
    'TELEGRAM_ALLOWED_CHAT_ID is not set.\n' +
      'Open Telegram, send any message to your bot, and the chat id will appear here.\n' +
      'Put it in .env, then run this command again.\n',
  );
  const messaging = new TelegramMessagingProvider({
    token,
    allowedConversationIds: [],
  });
  for await (const event of messaging.listen({ signal })) {
    console.log(`chat id ${event.providerConversationId} — "${event.text}"`);
    return;
  }
}

await main();
