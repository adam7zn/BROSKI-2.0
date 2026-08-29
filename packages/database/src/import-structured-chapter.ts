import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { structuredExtractionSchema } from '@math-study-companion/contracts';
import { Pool } from 'pg';

import { runMigrations } from './migration-runner.js';
import { PostgresSourceContentRepository } from './source-content-repository.js';

const inputPath = process.argv.slice(2).find((argument) => argument !== '--');
if (inputPath === undefined) {
  throw new Error(
    'Usage: tsx src/import-structured-chapter.ts <structured-json>',
  );
}
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres@127.0.0.1:54329/math_study_companion';
const extraction = structuredExtractionSchema.parse(
  JSON.parse(await readFile(path.resolve(inputPath), 'utf8')),
);
const pool = new Pool({ connectionString: databaseUrl });
try {
  await runMigrations(pool);
  const imported = await new PostgresSourceContentRepository(
    pool,
  ).importExtraction(extraction);
  console.info(
    `Imported ${imported.pageCount} pages and ${imported.blockCount} blocks ` +
      `into document ${imported.documentId} (run ${imported.runId}).`,
  );
} finally {
  await pool.end();
}
