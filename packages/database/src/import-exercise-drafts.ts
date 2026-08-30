import { readFile } from 'node:fs/promises';

import {
  pilotExerciseDraftManifestSchema,
  type PilotExerciseDraftManifest,
} from '@math-study-companion/contracts';
import { Pool, type QueryResultRow } from 'pg';

import { PostgresExerciseRepository } from './exercise-repository.js';

interface ResolvedSourceRow extends QueryResultRow {
  source_page_id: string;
  source_block_id: string | null;
}

export async function importPilotExerciseDrafts(
  pool: Pool,
  manifestInput: unknown,
): Promise<{ exerciseIds: string[]; importedDraftCount: number }> {
  const manifest = pilotExerciseDraftManifestSchema.parse(manifestInput);
  const repository = new PostgresExerciseRepository(pool);
  const exerciseIds: string[] = [];

  for (const exercise of manifest.exercises) {
    const source = await resolveSource(pool, manifest, exercise);
    const stored = await repository.createDraft({
      sourcePageId: source.source_page_id,
      sourceBlockId: source.source_block_id,
      sourceBoundingBox: exercise.sourceBoundingBox,
      sectionCode: exercise.sectionCode,
      sectionTitle: exercise.sectionTitle,
      exerciseNumber: exercise.exerciseNumber,
      partLabel: exercise.partLabel,
      topic: exercise.topic,
      prompt: exercise.prompt,
      answerPayload: exercise.answerPayload,
      solutionText: exercise.solutionText,
      rubric: exercise.rubric,
      difficulty: exercise.difficulty,
      gradingStrategy: exercise.gradingStrategy,
    });
    exerciseIds.push(stored.exerciseId);
  }

  return { exerciseIds, importedDraftCount: exerciseIds.length };
}

async function resolveSource(
  pool: Pool,
  manifest: PilotExerciseDraftManifest,
  exercise: PilotExerciseDraftManifest['exercises'][number],
): Promise<ResolvedSourceRow> {
  const found = await pool.query<ResolvedSourceRow>(
    `SELECT p.id AS source_page_id, b.id AS source_block_id
     FROM source_documents d
     JOIN source_pages p ON p.document_id = d.id
     LEFT JOIN source_blocks b
       ON b.source_page_id = p.id
      AND b.sequence_number = $4
      AND b.deleted_at IS NULL
     WHERE d.checksum = $1 AND d.version = $2
       AND p.printed_page_number = $3`,
    [
      manifest.sourceDocumentChecksum,
      manifest.sourceDocumentVersion,
      exercise.printedPageNumber,
      exercise.sourceBlockSequenceNumber,
    ],
  );
  if (found.rowCount !== 1 || !found.rows[0]) {
    throw new Error(
      `Expected one source page for printed page ${exercise.printedPageNumber}; found ${found.rowCount ?? 0}.`,
    );
  }
  if (
    exercise.sourceBlockSequenceNumber !== null &&
    found.rows[0].source_block_id === null
  ) {
    throw new Error(
      `Source block ${exercise.sourceBlockSequenceNumber} was not found on printed page ${exercise.printedPageNumber}.`,
    );
  }
  return found.rows[0];
}

function requireLocalDatabase(connectionString: string): void {
  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL.');
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
    throw new Error(
      'Private draft import is local-only. Publish only human-verified exercise snapshots after a hosted migration audit and explicit approval.',
    );
  }
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error(
      'Usage: pnpm --filter @math-study-companion/database db:import-exercise-drafts -- <private-manifest.json>',
    );
  }
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  requireLocalDatabase(connectionString);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  const pool = new Pool({ connectionString });
  try {
    const result = await importPilotExerciseDrafts(pool, manifest);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('import-exercise-drafts.ts')) {
  await main();
}
