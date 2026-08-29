import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  FakeMessagingProvider,
  ReplyInbox,
  TelegramMessagingProvider,
  runStudentSetup,
  summarise,
  type InboundSource,
  type MessagingProvider,
} from '@math-study-companion/conversation';

import { readConfig } from './config.js';
import {
  coursePlanFromProfile,
  writeCoursePlan,
} from './course-plan-from-profile.js';
import { openStore } from './wire.js';

/**
 * The first conversation with a new student, over the terminal or Telegram.
 *
 * `--telegram` runs it on the real device; without it the same questions are
 * asked in this terminal.
 */
async function main(): Promise<void> {
  const config = readConfig();
  const useTelegram = process.argv.includes('--telegram');
  const store = openStore(config);
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());

  let readline: ReturnType<typeof createInterface> | null = null;
  let messaging: MessagingProvider;
  let conversationId: string;

  if (useTelegram) {
    if (!config.telegramToken || !config.telegramChatId) {
      console.error(
        'Telegram is not configured. Set TELEGRAM_BOT_TOKEN and ' +
          'TELEGRAM_ALLOWED_CHAT_ID in .env, or run without --telegram.',
      );
      process.exitCode = 1;
      return;
    }
    messaging = new TelegramMessagingProvider({
      token: config.telegramToken,
      allowedConversationIds: [config.telegramChatId],
    });
    conversationId = config.telegramChatId;
  } else {
    messaging = new FakeMessagingProvider();
    conversationId = 'local-chat';
  }

  const inbox = new ReplyInbox();
  void inbox.pump(messaging as unknown as InboundSource, controller.signal);

  if (!useTelegram) {
    const fake = messaging as FakeMessagingProvider;
    readline = createInterface({ input: stdin, output: stdout });
    void (async () => {
      for await (const line of readline) fake.deliver(conversationId, line);
      controller.abort();
    })();
  }

  const existing = store.loadProfile(conversationId);
  if (existing) {
    console.log('\nThere is already a profile for this conversation:\n');
    console.log(summarise(existing));
    console.log('\nRunning setup again replaces it.\n');
  }

  try {
    const profile = await runStudentSetup({
      interactionId: `setup-${Date.now()}`,
      conversationId,
      messaging,
      inbox,
      timeoutMs: config.replyTimeoutMs,
      signal: controller.signal,
      onMessage: (entry) => {
        if (useTelegram) {
          console.log(
            `  ${entry.role === 'companion' ? 'broski ' : 'student'}  ${entry.text}`,
          );
        } else if (entry.role === 'companion') {
          stdout.write(`\nBroski: ${entry.text}\n\nDu: `);
        }
      },
    });

    store.saveProfile(conversationId, profile);
    console.log('\nSaved the profile.');

    if (profile.lessonSlots.length > 0) {
      const plan = coursePlanFromProfile(profile);
      writeCoursePlan(config.coursePlanPath, plan);
      console.log(
        `Wrote ${plan.lessons.length} lessons to ${config.coursePlanPath}.\n` +
          'Each lesson still needs its study items in "covers" before the ' +
          'companion can prepare or practise around it.',
      );
    } else {
      console.log(
        'No lesson times given, so the course calendar was left alone.',
      );
    }
  } finally {
    readline?.close();
    controller.abort();
    store.close();
  }
}

await main();
