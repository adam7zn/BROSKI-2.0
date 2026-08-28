import {
  ReplyInbox,
  TelegramMessagingProvider,
  runInteraction,
} from '@msc/conversation';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describeEnvKeys, readConfig, repoRoot } from './config.js';
import { buildAgent, openStore, planNextInteraction } from './wire.js';

/**
 * One real interaction over Telegram: send a question, wait for the reply,
 * evaluate it, send feedback, store everything exactly once.
 *
 * `--loop` keeps serving: after each interaction the companion waits for the
 * student to write anything before starting the next one. Starting is still
 * manual — scheduling and quiet hours belong to a later phase
 * (`docs/PHASES.md` Phase 5), and nothing here sends unprompted.
 */
async function main(): Promise<void> {
  const config = readConfig();
  const keepServing = process.argv.includes('--loop');

  if (!config.telegramToken) {
    // Say where it looked and what it found there, so the next step is obvious.
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

  const store = openStore(config);
  const agent = buildAgent(config);
  const messaging = new TelegramMessagingProvider({
    token: config.telegramToken,
    allowedConversationIds: [config.telegramChatId],
  });
  const inbox = new ReplyInbox();
  const pump = inbox.pump(messaging, controller.signal);
  pump.catch((error: unknown) => {
    console.error('Inbound listener stopped:', describe(error));
    controller.abort();
  });

  try {
    do {
      const planned = planNextInteraction(store, config, config.telegramChatId);
      console.log(
        `\nAsking about "${planned.item.topic}" — ${planned.reason}.\n` +
          `Interaction ${planned.context.interactionId}`,
      );

      const outcome = await runInteraction({
        context: planned.context,
        conversationId: config.telegramChatId,
        agent,
        messaging,
        inbox,
        replyTimeoutMs: config.replyTimeoutMs,
        signal: controller.signal,
      });

      store.saveOutcome(outcome);

      if (outcome.status === 'no_reply') {
        console.log('No reply within the window. Nothing stored as an attempt.');
        break;
      }

      console.log(`  asked     ${outcome.question.question}`);
      console.log(`  replied   ${outcome.reply.text}`);
      console.log(
        `  judged    ${outcome.result.result} ` +
          `(confidence ${outcome.evaluation.confidence.toFixed(2)}` +
          `${outcome.evaluation.deterministic ? ', deterministic' : ''})`,
      );
      console.log(`  feedback  ${outcome.evaluation.feedback}`);

      if (!keepServing) break;

      console.log('\nWaiting for him to write again before the next question…');
      const trigger = await inbox.waitFor(config.telegramChatId, {
        notBefore: new Date(),
        timeoutMs: 12 * 60 * 60 * 1000,
        signal: controller.signal,
      });
      if (!trigger) break;
    } while (!controller.signal.aborted);
  } finally {
    controller.abort();
    store.close();
  }
}

/** First-run helper: prints the chat id of whoever writes to the bot. */
async function discoverChatId(token: string, signal: AbortSignal): Promise<void> {
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await main();
