import type Anthropic from '@anthropic-ai/sdk';

import {
  ClaudeDocumentReader,
  ModelCallError,
  ReplyInbox,
  isReadableByModel,
  runInteraction,
  runTutorTurn,
  type AttachmentDownloader,
  type DocumentKind,
  type DocumentReader,
  type DownloadedAttachment,
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
 * How much of a photo to keep in memory to show the model on later turns.
 *
 * A page off a phone camera is a couple of megabytes; a scanned PDF of a whole
 * chapter is not something to carry around between messages.
 */
const MAX_REMEMBERED_BYTES = 6 * 1024 * 1024;

/** What to say for the student when they send a page and type nothing. */
const PHOTO_ONLY_QUESTION =
  'Jag har fotat den här sidan. Kan du hjälpa mig med den?';

/**
 * The companion, over whatever pipe it was handed.
 *
 * Telegram and Sendblue differ only in how bytes reach the phone: the setup
 * conversation, the tutoring, the uploads, and the study interactions are the
 * same code either way. That is the whole point of ADR-006, and the reason
 * swapping channel is a runner change rather than a rewrite.
 */
/** What one upload left behind, for the next question to lean on. */
interface RememberedUpload {
  savedPages: BookPage[];
  file: DownloadedAttachment | null;
  kind: DocumentKind | null;
}

/**
 * Whether this upload is maths the student wants help with.
 *
 * Anything but a plan, a timetable, or an unreadable photo counts: a page the
 * reader could not classify is still far more likely to be an exercise they
 * are stuck on than something to file away.
 */
function isMaths(kind: DocumentKind | null): boolean {
  return kind === 'material' || kind === 'assignment' || kind === 'other';
}

/** Whether a file is small enough and readable enough to show the model later. */
function worthKeeping(
  file: DownloadedAttachment | null,
): file is DownloadedAttachment {
  return (
    file !== null &&
    isReadableByModel(file.mimeType) &&
    file.bytes.byteLength <= MAX_REMEMBERED_BYTES
  );
}

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
  /**
   * Overrides for the two model-backed pieces, so the whole loop — uploads,
   * tutoring, the lot — can be driven without a network.
   */
  reader?: DocumentReader;
  tutorClient?: Anthropic;
}

export async function serve(options: ServeOptions): Promise<void> {
  const { config, messaging, inbound, conversationId, signal } = options;
  const store = openStore(config);
  const agent = buildAgent(config);
  const inbox = new ReplyInbox();

  // Photos and files are read out of band; they are never an answer to a
  // question, so they must not reach the reply inbox.
  const reader: DocumentReader | null =
    options.reader ?? (config.hasModelKey ? new ClaudeDocumentReader() : null);

  // What the student photographed most recently. A question that arrives with
  // a picture, or right after one, is almost always about that picture — so
  // both the text read off it and the picture itself are kept for the next
  // turn, and the picture is what gets answered.
  let recentlyUploaded: BookPage[] = [];
  let recentFiles: DownloadedAttachment[] = [];
  const history: TutorMessage[] = [];

  const remember = (upload: RememberedUpload): void => {
    // A plan or a timetable is not what the next maths question is about, so
    // it must not become the picture the tutor answers from.
    if (!isMaths(upload.kind)) return;
    // A new photo replaces the last one whole. Answering about the picture
    // before it is worse than having no picture at all.
    recentlyUploaded = upload.savedPages;
    recentFiles = worthKeeping(upload.file) ? [upload.file] : [];
  };

  /** One tutoring turn: ask the book and the picture, reply, remember it. */
  const answer = async (
    question: string,
    idempotencyKey: string,
  ): Promise<void> => {
    const turn = await runTutorTurn({
      question,
      history,
      pages: store.bookPages(),
      pinned: recentlyUploaded,
      files: recentFiles,
      ...(options.tutorClient ? { client: options.tutorClient } : {}),
    });
    history.push({ role: 'student', text: question });
    history.push({ role: 'companion', text: turn.answer });

    await messaging.sendMessage({
      conversationId,
      text: turn.answer,
      idempotencyKey,
    });
    console.log(
      `  broski     ${turn.answer}` +
        (turn.covered
          ? `  [${turn.usedPages.join(', ')}]`
          : '  [inte i boken]'),
    );
  };

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
        remember,
        // A photo of an exercise with nothing typed is a question. Answering
        // it here, rather than filing it and waiting to be asked, is the whole
        // point of being able to see the page.
        tutorAboutPhoto: async (key) => {
          try {
            await answer(PHOTO_ONLY_QUESTION, `photo:${key}`);
          } catch (error) {
            const text =
              error instanceof ModelCallError
                ? error.studentMessage
                : 'Något gick fel när jag tittade på bilden. Prova igen.';
            await messaging.sendMessage({
              conversationId,
              text,
              idempotencyKey: `photo-failed:${key}`,
            });
            console.error(`Photo answer failed: ${describe(error)}`);
          }
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

      await answer(incoming.text, `tutor:${incoming.providerMessageId}`);

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
  remember: (upload: RememberedUpload) => void;
  tutorAboutPhoto: (key: string) => Promise<void>;
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
    const { message, savedPages, file, kind } = await handleUpload({
      attachment,
      downloader: input.downloader,
      reader: input.reader,
      profile,
      config: input.config,
      store: input.store,
      conversationId: input.conversationId,
    });
    input.remember({ savedPages, file, kind });

    // A page of maths with no caption gets helped with, not filed. A plan or a
    // timetable gets the receipt, because what it changed is worth saying.
    if (isMaths(kind) && input.event.text === '') {
      await input.tutorAboutPhoto(attachment.providerFileId);
    } else {
      await say(message, attachment.providerFileId);
    }
  }

  // A photo with a caption may still be answering something.
  return input.event.text === '';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
