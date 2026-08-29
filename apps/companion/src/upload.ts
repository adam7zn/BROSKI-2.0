import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import {
  ClaudeDocumentReader,
  type AttachmentDownloader,
  type DownloadedAttachment,
  type InboundAttachment,
} from '@math-study-companion/conversation';

import { readConfig } from './config.js';
import { handleUpload } from './handle-upload.js';
import { openStore } from './wire.js';

/**
 * Reads a local file as if the student had sent it, so the upload path can be
 * tried without a phone: `pnpm upload data/planering.jpg`.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const path = process.argv[2];
if (!path) {
  console.error('Usage: pnpm upload <file>');
  console.error('  a photo (jpg, png, webp) or a PDF of a plan or assignment');
  process.exit(1);
}

const config = readConfig();
if (!config.hasModelKey) {
  console.error(
    'Reading a document needs ANTHROPIC_API_KEY in .env — there is no offline\n' +
      'way to read a photo.',
  );
  process.exit(1);
}

const store = openStore(config);
const conversationId = config.telegramChatId || 'local-chat';

try {
  const profile = store.loadProfile(conversationId);
  if (!profile) {
    console.error(
      `No profile for "${conversationId}" yet. Run "pnpm onboard" first — the ` +
        'lesson times it collects decide what time the lessons in a plan start.',
    );
    process.exit(1);
  }

  const bytes = new Uint8Array(readFileSync(path));
  const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()];
  if (!mimeType) {
    console.error(`I can read images and PDFs. ${extname(path)} is neither.`);
    process.exit(1);
  }

  const attachment: InboundAttachment = {
    kind: mimeType === 'application/pdf' ? 'document' : 'photo',
    providerFileId: `local:${basename(path)}`,
    fileName: basename(path),
    mimeType,
    sizeBytes: bytes.byteLength,
  };

  const downloader: AttachmentDownloader = {
    async downloadAttachment(): Promise<DownloadedAttachment> {
      return { bytes, mimeType, fileName: basename(path) };
    },
  };

  const { message, result } = await handleUpload({
    attachment,
    downloader,
    reader: new ClaudeDocumentReader(),
    profile,
    config,
    store,
    conversationId,
  });

  console.log(`\n${message}\n`);
  if (result?.coursePlan) {
    console.log(`Course calendar: ${config.coursePlanPath}`);
    for (const lesson of result.coursePlan.lessons.slice(0, 10)) {
      console.log(`  ${lesson.startsAt}  ${lesson.topic}`);
    }
  }
  if (result && result.studyItems.length > 0) {
    console.log(`\nStudy plan: ${config.studyPlanPath}`);
    for (const item of result.studyItems.slice(0, 10)) {
      console.log(`  ${item.id.padEnd(30)} ${item.topic}`);
    }
  }
  if (result && result.undated.length > 0) {
    console.log('\nRows with no date, kept as topics only:');
    for (const row of result.undated) {
      console.log(`  ${row.whenText ?? '?'}  ${row.topic}`);
    }
  }
} finally {
  store.close();
}
