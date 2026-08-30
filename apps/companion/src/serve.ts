import {
  ClaudeDocumentReader,
  ModelCallError,
  ReplyInbox,
  runInteraction,
  runTutorTurn,
  type AttachmentDownloader,
  type DocumentReader,
  type InboundMessageEvent,
  type InboundSource,
  type MessagingProvider,
  type StudyAgent,
  type TutorMessage,
} from '@math-study-companion/conversation';

import type { Config } from './config.js';
import { handleUpload } from './handle-upload.js';
import type { BookPage } from './local-store.js';
import { ensureProfile } from './setup-gate.js';
import { buildAgent, openStore, planNextInteraction } from './wire.js';

/**
 * The companion, over whatever pipe it was handed.
 *
 * Telegram and Sendblue differ only in how bytes reach the phone: the setup
 * conversation, the tutoring, the uploads, and the study interactions are the
 * same code either way. That is the whole point of ADR-006, and the reason
 * swapping channel is a runner change rather than a rewrite.
 */
export interface ServeOptions {
  config: Config;
  messaging: MessagingProvider;
  inbound: InboundSource;
  /** Present when the transport can fetch the files people send. */
  downloader: AttachmentDownloader | null;
  conversationId: string;
  signal: AbortSignal;
  stopAfterOne: boolean;
  force: boolean;
}

export async function serve(options: ServeOptions): Promise<void> {
  const { config, messaging, inbound, conversationId, signal } = options;
  const store = openStore(config);
  const agent = buildAgent(config);
  const inbox = new ReplyInbox();

  // Photos and files are read out of band; they are never an answer to a
  // question, so they must not reach the reply inbox.
  const reader: DocumentReader | null = config.hasModelKey
    ? new ClaudeDocumentReader()
    : null;

  // What the student photographed most recently. A question that arrives with
  // a picture, or right after one, is almost always about that picture.
  let recentlyUploaded: BookPage[] = [];

  const pump = inbox.pump(inbound, signal, {
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
        downloader: options.downloader,
        reader,
        store,
        config,
        conversationId,
        onPagesSaved: (pages) => {
          if (pages.length > 0) recentlyUploaded = pages;
        },
      });
    },
  });
  pump.catch((error: unknown) => {
    console.error('Inbound listener stopped:', describe(error));
  });

  try {
    const profile = await ensureProfile({
      store,
      config,
      conversationId,
      messaging,
      inbox,
      signal,
      onMessage: (entry) => {
        console.log(
          `  ${entry.role === 'companion' ? 'broski ' : 'student'}  ${entry.text}`,
        );
      },
    });
    console.log(`\nTalking to ${profile.displayName} over ${messaging.name}.`);

    const pages = store.bookPages();
    if (pages.length > 0) {
      console.log(`${pages.length} pages of the book indexed.`);
    } else {
      console.log(
        'NO BOOK INDEXED. Every question will be declined until the pages are\n' +
          'read. In another terminal:  pnpm index-book chapter-1',
      );
    }
    console.log('\nListening. Write anything, or "plugga" for a question.\n');

    const history: TutorMessage[] = [];

    while (!signal.aborted) {
      const incoming = await inbox.next(conversationId, {
        timeoutMs: 12 * 60 * 60 * 1000,
        signal,
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
          conversationId,
          signal,
          force: options.force,
        });
        continue;
      }

      const turn = await runTutorTurn({
        question: incoming.text,
        history,
        pages: store.bookPages(),
        pinned: recentlyUploaded,
      });
      history.push({ role: 'student', text: incoming.text });
      history.push({ role: 'companion', text: turn.answer });

      await messaging.sendMessage({
        conversationId,
        text: turn.answer,
        idempotencyKey: `tutor:${incoming.providerMessageId}`,
      });
      console.log(
        `  broski     ${turn.answer}` +
          (turn.covered
            ? `  [${turn.usedPages.join(', ')}]`
            : '  [inte i boken]'),
      );

      if (options.stopAfterOne) break;
    }
  } catch (error) {
    if (error instanceof ModelCallError) {
      console.error(`\nStopped: ${error.message}`);
      if (error.status === 401 || error.status === 403) {
        console.error('Check ANTHROPIC_API_KEY in .env.');
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    store.close();
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
  config: Config;
  agent: StudyAgent;
  messaging: MessagingProvider;
  inbox: ReplyInbox;
  conversationId: string;
  signal: AbortSignal;
  force: boolean;
}): Promise<void> {
  const { conversationId } = input;
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
  messaging: MessagingProvider;
  downloader: AttachmentDownloader | null;
  reader: DocumentReader | null;
  store: ReturnType<typeof openStore>;
  config: Config;
  conversationId: string;
  onPagesSaved?: (pages: BookPage[]) => void;
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

  if (!input.reader || !input.downloader) {
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
    const { message, savedPages } = await handleUpload({
      attachment,
      downloader: input.downloader,
      reader: input.reader,
      profile,
      config: input.config,
      store: input.store,
      conversationId: input.conversationId,
    });
    input.onPagesSaved?.(savedPages);
    await say(message, attachment.providerFileId);
  }

  // A photo with a caption may still be answering something.
  return input.event.text === '';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
