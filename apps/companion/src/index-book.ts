import { readFileSync } from 'node:fs';
import { basename, extname, relative } from 'node:path';

import {
  ClaudeDocumentReader,
  UnsupportedFileError,
} from '@math-study-companion/conversation';

import { MIME_BY_EXTENSION, findPages, idFor, labelFor } from './book-files.js';
import { PathNotFoundError, readConfig, resolveUserPath } from './config.js';
import { openStore } from './wire.js';

/**
 * Reads the pages of the student's book once, so every later answer can be
 * grounded in them: `pnpm index-book chapter-1`.
 *
 * Only the text is stored. The images stay where they are, and re-running skips
 * pages already read — sixty pages is real money and a long wait, and a run
 * that dies half way should not start over.
 */
const args = process.argv.slice(2);
const folder = args.find((arg) => !arg.startsWith('--'));
const redoEverything = args.includes('--force');

if (!folder) {
  console.error('Usage: pnpm index-book <folder> [--force]');
  console.error('  reads every image and PDF in the folder, and below it');
  console.error('  --force re-reads pages that are already indexed');
  process.exit(1);
}

const config = readConfig();
if (!config.hasModelKey) {
  console.error('Reading pages needs ANTHROPIC_API_KEY in .env.');
  process.exit(1);
}

let root: string;
try {
  root = resolveUserPath(folder);
} catch (error) {
  if (error instanceof PathNotFoundError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const store = openStore(config);
const reader = new ClaudeDocumentReader();

try {
  const files = findPages(root);
  if (files.length === 0) {
    console.error(`No images or PDFs in ${folder}.`);
    process.exit(1);
  }

  const alreadyIndexed = new Set(store.bookPages().map((page) => page.id));
  const todo = redoEverything
    ? files
    : files.filter((file) => !alreadyIndexed.has(idFor(root, file)));

  console.log(`${files.length} pages found in ${root}.`);
  if (todo.length < files.length) {
    console.log(
      `${files.length - todo.length} already indexed — skipping them. ` +
        'Use --force to read them again.',
    );
  }
  if (todo.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }
  console.log(
    `Reading ${todo.length} pages. This makes one model call per page, so it ` +
      'takes a few minutes and costs a few dollars.\n',
  );

  let read = 0;
  let skipped = 0;

  for (const [index, file] of todo.entries()) {
    const shown = relative(root, file);
    process.stdout.write(
      `  ${String(index + 1).padStart(3)}/${todo.length}  ${shown.padEnd(42)}`,
    );

    try {
      const reading = await reader.read({
        bytes: new Uint8Array(readFileSync(file)),
        mimeType: MIME_BY_EXTENSION[extname(file).toLowerCase()]!,
        fileName: basename(file),
      });

      const text =
        reading.extractedText?.trim() ||
        reading.rows
          .map((row) => `${row.topic} ${row.reference ?? ''}`.trim())
          .join('\n');

      if (reading.kind === 'unreadable' || text === '') {
        console.log('could not read it');
        skipped += 1;
        continue;
      }

      store.saveBookPage({
        id: idFor(root, file),
        label: labelFor(file),
        text,
        sourceKind: 'indexed',
      });
      read += 1;
      console.log(`${labelFor(file).padEnd(14)} ${text.length} tecken`);
    } catch (error) {
      skipped += 1;
      console.log(
        error instanceof UnsupportedFileError ? 'unsupported' : 'failed',
      );
      if (!(error instanceof UnsupportedFileError)) {
        console.error(`      ${describe(error)}`);
        console.error(
          '      Stopping here. Run the same command again to carry on ' +
            'from this page.',
        );
        break;
      }
    }
  }

  console.log(
    `\n${read} pages read, ${skipped} skipped. ` +
      `${store.bookPageCount()} pages in the book now.`,
  );
} finally {
  store.close();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
