import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ClaudeDocumentReader,
  ModelCallError,
  ReplyInbox,
  TelegramMessagingProvider,
  runInteraction,
  runTutorTurn,
  type DocumentReader,
  type StudyAgent,
  type TutorMessage,
  type InboundMessageEvent,
} from '@math-study-companion/conversation';

import { describeEnvKeys, readConfig, repoRoot } from './config.js';
import { handleUpload } from './handle-upload.js';
import { ensureProfile } from './setup-gate.js';
import { buildAgent, openStore, planNextInteraction } from './wire.js';

/**
 * One real conversation over Telegram: ask what the timeline says is worth
 * asking, talk it through, judge the answer, store everything exactly once.
 *
 * It keeps serving until stopped. `--once` answers a single message and exits;
 * `--force` asks a study question even when the planner would stay quiet.
 * Nothing is ever sent unprompted — scheduling and quiet hours belong to a
 * later phase (`docs/PHASES.md` Phase 5).
 */
async function main(): Promise<void> {
  const config = readConfig();
  // It is a chat partner, so serving until stopped is the normal thing to do.
  const stopAfterOne = process.argv.includes('--once');
  const force = process.argv.includes('--force');

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

  const store = openStore(config);
  const agent = buildAgent(config);
  const messaging = new TelegramMessagingProvider({
    token: config.telegramToken,
    allowedConversationIds: [config.telegramChatId],
  });
  const inbox = new ReplyInbox();
  // Photos and files are read out of band; they are never an answer to a
  // question, so they must not reach the reply inbox.
  const reader: DocumentReader | null = config.hasModelKey
    ? new ClaudeDocumentReader()
    : null;
  const pump = inbox.pump(messaging, controller.signal, {
    intercept: (event) => {
      console.log(
        `  <- ${event.text || '(no text)'}` +
          (event.attachments.length > 0
            ? ` [${event.attachments.length} attachment(s)]`
            : ''),
      );
      return handleAttachments({
        event,
        messaging,
        reader,
        store,
        config,
        conversationId: config.telegramChatId,
      });
    },
  });
  pump.catch((error: unknown) => {
    console.error('Inbound listener stopped:', describe(error));
    controller.abort();
  });

  try {
    const profile = await ensureProfile({
      store,
      config,
      conversationId: config.telegramChatId,
      messaging,
      inbox,
      signal: controller.signal,
      onMessage: (entry) => {
        console.log(
          `  ${entry.role === 'companion' ? 'broski ' : 'student'}  ${entry.text}`,
        );
      },
    });
    console.log(`\nTalking to ${profile.displayName}.`);
    console.log(
      'Send a photo of your term plan, schedule, or an assignment and I will read it.',
    );

    const pages = store.bookPages();
    console.log(
      pages.length > 0
        ? `${pages.length} pages of the book indexed.`
        : 'No book pages indexed yet — questions about the book will be declined.',
    );
    console.log(
      '\nListening. Write anything to the bot, or "plugga" for a question.',
    );
    console.log('Every message that arrives is logged here.\n');

    const history: TutorMessage[] = [];

    // The companion is a chat partner by default. A planned study interaction
    // takes over the conversation while it runs, and hands it back after.
    while (!controller.signal.aborted) {
      const incoming = await inbox.next(config.telegramChatId, {
        timeoutMs: 12 * 60 * 60 * 1000,
        signal: controller.signal,
      });
      if (!incoming) break;
      console.log(`  student    ${incoming.text}`);

      if (wantsStudyItem(incoming.text)) {
        await study({
          store,
          config,
          agent,
          messaging,
          inbox,
          signal: controller.signal,
          force,
        });
        continue;
      }

      const turn = await runTutorTurn({
        question: incoming.text,
        history,
        pages: store.bookPages(),
      });
      history.push({ role: 'student', text: incoming.text });
      history.push({ role: 'companion', text: turn.answer });

      await messaging.sendMessage({
        conversationId: config.telegramChatId,
        text: turn.answer,
        idempotencyKey: `tutor:${incoming.providerMessageId}`,
      });
      console.log(
        `  broski     ${turn.answer}` +
          (turn.covered
            ? `  [${turn.usedPages.join(', ')}]`
            : '  [inte i boken]'),
      );

      if (stopAfterOne) break;
    }
  } catch (error) {
    if (error instanceof ModelCallError) {
      // The student has already been told in their own words; this is for
      // whoever is watching the terminal.
      console.error(`\nStopped: ${error.message}`);
      if (error.status === 401 || error.status === 403) {
        console.error(
          'Check ANTHROPIC_API_KEY in .env — that is what the API rejected.',
        );
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    controller.abort();
    store.close();
  }
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

/** Words that mean "give me something to practise on". */
function wantsStudyItem(text: string): boolean {
  return /^\s*[/]?(plugga|öva|ova|fråga mig|fraga mig|quiz|träna|trana)\b/i.test(
    text,
  );
}

/** One planned study interaction, start to finish. */
async function study(input: {
  store: ReturnType<typeof openStore>;
  config: ReturnType<typeof readConfig>;
  agent: StudyAgent;
  messaging: TelegramMessagingProvider;
  inbox: ReplyInbox;
  signal: AbortSignal;
  force: boolean;
}): Promise<void> {
  const conversationId = input.config.telegramChatId;
  const planned = planNextInteraction(
    input.store,
    input.config,
    conversationId,
    {
      force: true,
    },
  );

  if (!planned.context) {
    await input.messaging.sendMessage({
      conversationId,
      text: `Inget att öva på just nu: ${planned.decision.reason}.`,
      idempotencyKey: `noaction:${Date.now()}`,
    });
    return;
  }

  console.log(
    `\n[${planned.decision.mode}] ${planned.context.topic} — ${planned.decision.reason}.`,
  );

  const outcome = await runInteraction({
    context: planned.context,
    conversationId,
    agent: input.agent,
    messaging: input.messaging,
    inbox: input.inbox,
    replyTimeoutMs: input.config.replyTimeoutMs,
    signal: input.signal,
    onMessage: (entry) => {
      console.log(
        `  ${entry.role === 'companion' ? 'broski ' : 'student'}  ${entry.text}`,
      );
    },
  });

  input.store.saveOutcome(outcome);
  console.log(
    outcome.status === 'completed'
      ? `  judged     ${outcome.result.result}`
      : '  no reply within the window; nothing stored as an attempt.',
  );
}

/**
 * Deals with any photo or file on an incoming message.
 *
 * Returns true when the message was an upload and nothing else, so the inbox
 * never sees it. A message with both a caption and a photo is handled here and
 * still passed on, because the caption may well be the answer to a question.
 */
async function handleAttachments(input: {
  event: InboundMessageEvent;
  messaging: TelegramMessagingProvider;
  reader: DocumentReader | null;
  store: ReturnType<typeof openStore>;
  config: ReturnType<typeof readConfig>;
  conversationId: string;
}): Promise<boolean> {
  const { attachments } = input.event;
  if (attachments.length === 0) return false;

  const say = async (text: string, key: string): Promise<void> => {
    await input.messaging.sendMessage({
      conversationId: input.conversationId,
      text,
      idempotencyKey: `upload:${key}`,
    });
    console.log(`  broski     ${text}`);
  };

  if (!input.reader) {
    await say(
      'Jag kan inte läsa bilder just nu — ingen modellnyckel är inställd.',
      `${input.event.providerMessageId}:no-reader`,
    );
    return input.event.text === '';
  }

  const profile = input.store.loadProfile(input.conversationId);
  if (!profile) return false;

  for (const attachment of attachments) {
    console.log(`  upload     ${attachment.kind}`);
    const { message } = await handleUpload({
      attachment,
      downloader: input.messaging,
      reader: input.reader,
      profile,
      config: input.config,
      store: input.store,
      conversationId: input.conversationId,
    });
    await say(message, attachment.providerFileId);
  }

  // A photo with a caption may still be answering something.
  return input.event.text === '';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await main();
