import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import {
  ClaudeDocumentReader,
  UnsupportedFileError,
} from '@math-study-companion/conversation';

import { readConfig } from './config.js';
import { openStore } from './wire.js';

/**
 * Reads a folder of book pages once, so every later answer can be grounded in
 * them: `pnpm index-book data/bok`.
 *
 * The images stay where they are. Only the text is stored, and nothing is
 * committed — a textbook is copyrighted, and `docs/RULES.md` §8.2 keeps what is
 * stored to what the pilot needs.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: pnpm index-book <folder>');
  console.error('  every image or PDF in the folder is read as one page');
  process.exit(1);
}

const config = readConfig();
if (!config.hasModelKey) {
  console.error('Reading pages needs ANTHROPIC_API_KEY in .env.');
  process.exit(1);
}

const store = openStore(config);
const reader = new ClaudeDocumentReader();

try {
  const files = readdirSync(folder)
    .filter((name) => MIME_BY_EXTENSION[extname(name).toLowerCase()])
    .sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));

  if (files.length === 0) {
    console.error(`No images or PDFs in ${folder}.`);
    process.exit(1);
  }

  console.log(`Reading ${files.length} pages from ${folder}…\n`);
  let read = 0;
  let skipped = 0;

  for (const name of files) {
    const path = join(folder, name);
    const mimeType = MIME_BY_EXTENSION[extname(name).toLowerCase()]!;
    process.stdout.write(`  ${name.padEnd(34)}`);

    try {
      const reading = await reader.read({
        bytes: new Uint8Array(readFileSync(path)),
        mimeType,
        fileName: name,
      });

      const text =
        reading.extractedText?.trim() ||
        reading.rows
          .map((row) => `${row.topic} ${row.reference ?? ''}`)
          .join('\n');

      if (reading.kind === 'unreadable' || text === '') {
        console.log('could not read it');
        skipped += 1;
        continue;
      }

      // The file name is usually the page number, and is what the student will
      // recognise when an answer cites it.
      store.saveBookPage({
        id: name,
        label: labelFor(name, reading.summary),
        text,
        sourceKind: 'indexed',
      });
      read += 1;
      console.log(`ok (${text.length} tecken)`);
    } catch (error) {
      skipped += 1;
      console.log(
        error instanceof UnsupportedFileError ? 'unsupported' : 'failed',
      );
      if (!(error instanceof UnsupportedFileError)) throw error;
    }
  }

  console.log(
    `\n${read} pages indexed, ${skipped} skipped. ` +
      `${store.bookPageCount()} pages in the book now.`,
  );
} finally {
  store.close();
}

/** "s84.jpg" becomes "s. 84"; anything else keeps the file name. */
function labelFor(fileName: string, summary: string): string {
  const stem = basename(fileName, extname(fileName));
  const page = /(?:^|\D)(\d{1,3})(?:\D|$)/.exec(stem);
  if (page) return `s. ${page[1]}`;
  return summary.trim().slice(0, 40) || stem;
}

/** Keeps the compiler honest about statSync being unused on some paths. */
void statSync;
