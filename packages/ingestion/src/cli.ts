import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  structuredExtractionSchema,
  type ExtractedSourceBlock,
} from '@math-study-companion/contracts';

import { structurePage, validateLatex, type RawVisionPage } from './index.js';
import { Pix2TexClient } from './pix2tex-client.js';

const valueAfter = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const checkpointsValue = valueAfter('--checkpoints');
const outputValue = valueAfter('--output');
if (checkpointsValue === undefined || outputValue === undefined) {
  throw new Error(
    'Usage: tsx src/cli.ts --checkpoints <dir> --output <json> [--pix2tex]',
  );
}

const checkpoints = path.resolve(checkpointsValue);
const filenames = (await readdir(checkpoints))
  .filter((name) => /^page-\d+\.json$/u.test(name))
  .sort();
if (filenames.length === 0)
  throw new Error(`No page checkpoints found in ${checkpoints}.`);
const pages = await Promise.all(
  filenames.map(
    async (name) =>
      JSON.parse(
        await readFile(path.join(checkpoints, name), 'utf8'),
      ) as RawVisionPage,
  ),
);
const checksum = createHash('sha256');
for (const page of pages) checksum.update(await readFile(page.imagePath));

let client: Pix2TexClient | undefined;
if (process.argv.includes('--pix2tex')) {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(directory, '../../../scripts/pix2tex-local.py');
  const python =
    process.env.BROSKI_OCR_PYTHON ??
    '/opt/homebrew/opt/python@3.11/bin/python3.11';
  client = new Pix2TexClient(python, script);
}

const extractedPages = [];
try {
  for (const page of pages) {
    const blocks = structurePage(page);
    if (client !== undefined) {
      for (const block of blocks.filter(
        (item) => item.blockType === 'formula',
      )) {
        try {
          const result = await client.recognize(
            page.imagePath,
            block.boundingBox,
          );
          if (result.latex !== undefined && result.latex.trim() !== '') {
            const latex = result.latex.trim();
            block.candidates.push({
              engine: 'pix2tex',
              passName: 'formula',
              contentMarkdown: `$$\n${latex}\n$$`,
              latex,
              confidence: result.confidence ?? null,
              metadata: { device: 'cpu', batchSize: 1 },
            });
            block.reviewReasons.push(...validateLatex(latex));
          } else block.reviewReasons.push('pix2tex_failed');
        } catch (error) {
          block.reviewReasons.push('pix2tex_failed');
          block.candidates.push({
            engine: 'pix2tex',
            passName: 'formula-error',
            contentMarkdown: '',
            latex: null,
            confidence: null,
            metadata: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
        block.reviewReasons = [...new Set(block.reviewReasons)];
      }
    }
    extractedPages.push({
      filePageNumber: page.filePageNumber,
      printedPageNumber: page.printedPageNumber ?? null,
      imagePath: path.resolve(page.imagePath),
      width: page.width,
      height: page.height,
      blocks: blocks as ExtractedSourceBlock[],
    });
    console.info(
      `structured page ${page.printedPageNumber ?? page.filePageNumber}`,
    );
  }
} finally {
  await client?.close();
}

const extraction = structuredExtractionSchema.parse({
  schemaVersion: 1,
  pipelineVersion: 'local-vision-pix2tex-v1',
  documentTitle: 'Chapter 1 — Algebraiska uttryck',
  inputChecksum: checksum.digest('hex'),
  configuration: {
    externalRequests: false,
    recognitionLanguages: ['sv-SE', 'en-US'],
    appleVisionPasses: ['original', 'contrast'],
    pix2tex: client !== undefined,
    pix2texDevice: 'cpu',
    batchSize: 1,
  },
  pages: extractedPages,
});
await writeFile(
  path.resolve(outputValue),
  `${JSON.stringify(extraction, null, 2)}\n`,
  'utf8',
);
console.info(
  `wrote ${extraction.pages.length} pages to ${path.resolve(outputValue)}`,
);
