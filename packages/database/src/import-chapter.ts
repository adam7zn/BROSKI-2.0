import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Pool } from 'pg';

import { runMigrations } from './migration-runner.js';

interface OCRLine {
  text: string;
  confidence: number;
  boundingBox: number[];
}

interface OCRPage {
  filePageNumber: number;
  printedPageNumber: string | null;
  imagePath: string;
  extractedText: string;
  confidence: number;
  cropApplied: boolean;
  cropConfidence: number | null;
  cropBoundingBox: number[] | null;
  lines: OCRLine[];
}

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres@127.0.0.1:54329/math_study_companion';
const inputPath = process.argv.slice(2).find((argument) => argument !== '--');

if (inputPath === undefined) {
  throw new Error('Usage: tsx src/import-chapter.ts <ocr-json>');
}

const absoluteInputPath = path.resolve(inputPath);
const rawInput = await readFile(absoluteInputPath);
const pages = JSON.parse(rawInput.toString('utf8')) as OCRPage[];

if (!Array.isArray(pages) || pages.length === 0) {
  throw new Error('OCR input must contain at least one page.');
}

const checksumBuilder = createHash('sha256');
for (const page of pages) {
  checksumBuilder.update(String(page.filePageNumber));
  checksumBuilder.update(await readFile(page.imagePath));
}
const documentChecksum = checksumBuilder.digest('hex');

const pool = new Pool({ connectionString: databaseUrl });
await runMigrations(pool);
const client = await pool.connect();

try {
  await client.query('BEGIN');
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM source_documents WHERE checksum = $1 AND version = 1`,
    [documentChecksum],
  );
  const documentId = existing.rows[0]?.id ?? randomUUID();

  await client.query(
    `INSERT INTO source_documents (
       id, kind, title, storage_key, checksum, version, license_note, import_status
     ) VALUES ($1, 'textbook', $2, $3, $4, 1, $5, 'processing')
     ON CONFLICT (checksum, version) DO UPDATE SET
       title = EXCLUDED.title,
       storage_key = EXCLUDED.storage_key,
       license_note = EXCLUDED.license_note,
       import_status = 'processing'`,
    [
      documentId,
      'Chapter 1 — Algebraiska uttryck',
      path.dirname(path.dirname(absoluteInputPath)),
      documentChecksum,
      'Private personal-study source; do not publish or expose full text.',
    ],
  );

  for (const page of pages) {
    const lowConfidenceLines = page.lines.filter(
      (line) => line.confidence < 0.75,
    ).length;
    await client.query(
      `INSERT INTO source_pages (
         id, document_id, file_page_number, printed_page_number, extracted_text,
         page_image_key, extraction_confidence, verified_at, extraction_metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8::jsonb)
       ON CONFLICT (document_id, file_page_number) DO UPDATE SET
         printed_page_number = EXCLUDED.printed_page_number,
         extracted_text = EXCLUDED.extracted_text,
         page_image_key = EXCLUDED.page_image_key,
         extraction_confidence = EXCLUDED.extraction_confidence,
         verified_at = NULL,
         extraction_metadata = EXCLUDED.extraction_metadata`,
      [
        randomUUID(),
        documentId,
        page.filePageNumber,
        page.printedPageNumber,
        page.extractedText,
        page.imagePath,
        page.confidence,
        JSON.stringify({
          engine: 'Apple Vision',
          recognitionLanguages: ['sv-SE', 'en-US'],
          lineCount: page.lines.length,
          lowConfidenceLines,
          cropApplied: page.cropApplied,
          cropConfidence: page.cropConfidence,
          cropBoundingBox: page.cropBoundingBox,
          reviewStatus: 'needs_review',
          reviewReasons: [
            'mathematical_notation_requires_manual_verification',
            'reading_order_requires_manual_verification',
          ],
        }),
      ],
    );
  }

  await client.query(
    `UPDATE source_documents SET import_status = 'reviewed' WHERE id = $1`,
    [documentId],
  );
  await client.query('COMMIT');
  console.info(`Imported ${pages.length} pages into document ${documentId}.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
