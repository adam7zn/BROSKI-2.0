import { randomUUID } from 'node:crypto';

import type {
  BlockLayoutInput,
  BlockReviewInput,
  SourceBlockType,
  SourceBoundingBox,
  SourceCandidate,
  SourceReviewState,
  StructuredExtraction,
} from '@math-study-companion/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export interface SourceDocumentSummary {
  id: string;
  title: string;
  pageCount: number;
  resolvedBlockCount: number;
  totalBlockCount: number;
}

export interface SourcePageSummary {
  id: string;
  documentId: string;
  filePageNumber: number;
  printedPageNumber: string | null;
  imagePath: string;
  verifiedAt: Date | null;
  resolvedBlockCount: number;
  totalBlockCount: number;
}

export interface StoredSourceCandidate extends SourceCandidate {
  id: string;
  createdAt: Date;
}

export interface StoredSourceBlock {
  id: string;
  pageId: string;
  sequenceNumber: number;
  blockType: SourceBlockType;
  boundingBox: SourceBoundingBox;
  confidence: number | null;
  reviewState: SourceReviewState;
  reviewReasons: string[];
  contentMarkdown: string;
  candidates: StoredSourceCandidate[];
}

export interface SourcePageDetail extends SourcePageSummary {
  width: number | null;
  height: number | null;
  blocks: StoredSourceBlock[];
}

export interface SourceBlockImageReference {
  block: StoredSourceBlock;
  imagePath: string;
}

interface DocumentRow extends QueryResultRow {
  id: string;
  title: string;
  page_count: string;
  resolved_block_count: string;
  total_block_count: string;
}

interface PageRow extends QueryResultRow {
  id: string;
  document_id: string;
  file_page_number: number;
  printed_page_number: string | null;
  page_image_key: string | null;
  verified_at: Date | null;
  extraction_metadata: Record<string, unknown>;
  resolved_block_count: string;
  total_block_count: string;
}

interface BlockRow extends QueryResultRow {
  id: string;
  source_page_id: string;
  sequence_number: number;
  block_type: SourceBlockType;
  bounding_box: SourceBoundingBox;
  confidence: string | number | null;
  review_state: SourceReviewState;
  review_reasons: string[];
  current_content_markdown: string;
}

interface CandidateRow extends QueryResultRow {
  id: string;
  source_block_id: string;
  engine: SourceCandidate['engine'];
  pass_name: string;
  content_markdown: string;
  latex: string | null;
  confidence: string | number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

const numberOrNull = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

const rollback = async (client: PoolClient): Promise<void> => {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Keep the original error.
  }
};

const toPageSummary = (row: PageRow): SourcePageSummary => ({
  id: row.id,
  documentId: row.document_id,
  filePageNumber: row.file_page_number,
  printedPageNumber: row.printed_page_number,
  imagePath: row.page_image_key ?? '',
  verifiedAt: row.verified_at,
  resolvedBlockCount: Number(row.resolved_block_count),
  totalBlockCount: Number(row.total_block_count),
});

export class PostgresSourceContentRepository {
  constructor(private readonly pool: Pool) {}

  async importExtraction(extraction: StructuredExtraction): Promise<{
    documentId: string;
    runId: string;
    pageCount: number;
    blockCount: number;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const foundDocument = await client.query<{ id: string }>(
        'SELECT id FROM source_documents WHERE checksum = $1 AND version = 1',
        [extraction.inputChecksum],
      );
      const documentId = foundDocument.rows[0]?.id ?? randomUUID();
      await client.query(
        `INSERT INTO source_documents
           (id, kind, title, storage_key, checksum, version, license_note, import_status)
         VALUES ($1, 'textbook', $2, $3, $4, 1, $5, 'processing')
         ON CONFLICT (checksum, version) DO UPDATE SET
           title = EXCLUDED.title, storage_key = EXCLUDED.storage_key,
           import_status = 'processing'`,
        [
          documentId,
          extraction.documentTitle,
          extraction.pages[0]?.imagePath ?? '',
          extraction.inputChecksum,
          'Local personal-study source; never publish the textbook content.',
        ],
      );
      const foundRun = await client.query<{ id: string }>(
        `SELECT id FROM source_extraction_runs
         WHERE document_id = $1 AND pipeline_version = $2 AND input_checksum = $3`,
        [documentId, extraction.pipelineVersion, extraction.inputChecksum],
      );
      const runId = foundRun.rows[0]?.id ?? randomUUID();
      await client.query(
        `INSERT INTO source_extraction_runs
           (id, document_id, pipeline_version, input_checksum, configuration, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'processing')
         ON CONFLICT (document_id, pipeline_version, input_checksum) DO UPDATE SET
           configuration = EXCLUDED.configuration, status = 'processing', error_text = NULL`,
        [runId, documentId, extraction.pipelineVersion, extraction.inputChecksum,
          JSON.stringify(extraction.configuration)],
      );

      let blockCount = 0;
      for (const page of extraction.pages) {
        const pageResult = await client.query<{ id: string }>(
          `INSERT INTO source_pages
             (id, document_id, file_page_number, printed_page_number, extracted_text,
              page_image_key, extraction_confidence, verified_at, extraction_metadata,
              active_extraction_run_id)
           VALUES ($1, $2, $3, $4, NULL, $5, NULL, NULL, $6::jsonb, $7)
           ON CONFLICT (document_id, file_page_number) DO UPDATE SET
             printed_page_number = EXCLUDED.printed_page_number,
             page_image_key = EXCLUDED.page_image_key,
             verified_at = CASE
               WHEN source_pages.active_extraction_run_id = EXCLUDED.active_extraction_run_id
                 THEN source_pages.verified_at
               ELSE NULL
             END,
             active_extraction_run_id = EXCLUDED.active_extraction_run_id,
             extraction_metadata = source_pages.extraction_metadata || EXCLUDED.extraction_metadata
           RETURNING id`,
          [randomUUID(), documentId, page.filePageNumber, page.printedPageNumber,
            page.imagePath, JSON.stringify({ width: page.width, height: page.height,
              pipelineVersion: extraction.pipelineVersion, structuredReviewStatus: 'pending' }), runId],
        );
        const pageId = pageResult.rows[0]!.id;
        for (const block of page.blocks) {
          blockCount += 1;
          const preferred = block.candidates.find((candidate) => candidate.passName === 'original')
            ?? block.candidates[0]!;
          const blockResult = await client.query<{ id: string }>(
            `INSERT INTO source_blocks
               (id, source_page_id, extraction_run_id, source_key, sequence_number,
                block_type, bounding_box, confidence, review_state, review_reasons,
                current_content_markdown)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'pending', $9::jsonb, $10)
             ON CONFLICT (extraction_run_id, source_key) DO UPDATE SET
               sequence_number = EXCLUDED.sequence_number, block_type = EXCLUDED.block_type,
               bounding_box = EXCLUDED.bounding_box, confidence = EXCLUDED.confidence,
               review_reasons = EXCLUDED.review_reasons, updated_at = CURRENT_TIMESTAMP
             RETURNING id`,
            [randomUUID(), pageId, runId, block.sourceKey, block.sequenceNumber,
              block.blockType, JSON.stringify(block.boundingBox), block.confidence,
              JSON.stringify(block.reviewReasons), preferred.contentMarkdown],
          );
          const blockId = blockResult.rows[0]!.id;
          for (const candidate of block.candidates) {
            await client.query(
              `INSERT INTO source_block_candidates
                 (id, source_block_id, engine, pass_name, content_markdown,
                  latex, confidence, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
               ON CONFLICT (source_block_id, engine, pass_name) DO NOTHING`,
              [randomUUID(), blockId, candidate.engine, candidate.passName,
                candidate.contentMarkdown, candidate.latex, candidate.confidence,
                JSON.stringify(candidate.metadata)],
            );
          }
        }
      }
      await client.query(
        `UPDATE source_extraction_runs SET status = 'completed',
           completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) WHERE id = $1`, [runId],
      );
      await client.query('COMMIT');
      return { documentId, runId, pageCount: extraction.pages.length, blockCount };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listDocuments(): Promise<SourceDocumentSummary[]> {
    const result = await this.pool.query<DocumentRow>(
      `SELECT d.id, d.title, COUNT(DISTINCT p.id)::text AS page_count,
              COUNT(b.id) FILTER (WHERE b.review_state <> 'pending')::text AS resolved_block_count,
              COUNT(b.id)::text AS total_block_count
       FROM source_documents d
       LEFT JOIN source_pages p ON p.document_id = d.id
       LEFT JOIN source_blocks b ON b.source_page_id = p.id
         AND b.extraction_run_id = p.active_extraction_run_id AND b.deleted_at IS NULL
       GROUP BY d.id, d.title ORDER BY d.created_at DESC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      pageCount: Number(row.page_count),
      resolvedBlockCount: Number(row.resolved_block_count),
      totalBlockCount: Number(row.total_block_count),
    }));
  }

  async listPages(documentId: string): Promise<SourcePageSummary[]> {
    const result = await this.pool.query<PageRow>(
      `SELECT p.id, p.document_id, p.file_page_number, p.printed_page_number,
              p.page_image_key, p.verified_at, p.extraction_metadata,
              COUNT(b.id) FILTER (WHERE b.review_state <> 'pending')::text AS resolved_block_count,
              COUNT(b.id)::text AS total_block_count
       FROM source_pages p
       LEFT JOIN source_blocks b ON b.source_page_id = p.id
         AND b.extraction_run_id = p.active_extraction_run_id AND b.deleted_at IS NULL
       WHERE p.document_id = $1 GROUP BY p.id ORDER BY p.file_page_number`,
      [documentId],
    );
    return result.rows.map(toPageSummary);
  }

  async getPage(pageId: string): Promise<SourcePageDetail> {
    const pages = await this.pool.query<PageRow>(
      `SELECT p.id, p.document_id, p.file_page_number, p.printed_page_number,
              p.page_image_key, p.verified_at, p.extraction_metadata,
              COUNT(b.id) FILTER (WHERE b.review_state <> 'pending')::text AS resolved_block_count,
              COUNT(b.id)::text AS total_block_count
       FROM source_pages p
       LEFT JOIN source_blocks b ON b.source_page_id = p.id
         AND b.extraction_run_id = p.active_extraction_run_id AND b.deleted_at IS NULL
       WHERE p.id = $1 GROUP BY p.id`,
      [pageId],
    );
    const page = pages.rows[0];
    if (page === undefined) throw new Error(`Source page ${pageId} was not found.`);
    const blocks = await this.pool.query<BlockRow>(
      `SELECT id, source_page_id, sequence_number, block_type, bounding_box,
              confidence, review_state, review_reasons, current_content_markdown
       FROM source_blocks b JOIN source_pages p ON p.id = b.source_page_id
       WHERE b.source_page_id = $1 AND b.extraction_run_id = p.active_extraction_run_id
         AND b.deleted_at IS NULL
       ORDER BY sequence_number, id`,
      [pageId],
    );
    const blockIds = blocks.rows.map((row) => row.id);
    const candidateRows = blockIds.length === 0
      ? []
      : (await this.pool.query<CandidateRow>(
          `SELECT id, source_block_id, engine, pass_name, content_markdown,
                  latex, confidence, metadata, created_at
           FROM source_block_candidates WHERE source_block_id = ANY($1::uuid[])
           ORDER BY created_at, id`, [blockIds],
        )).rows;
    const candidates = new Map<string, StoredSourceCandidate[]>();
    for (const row of candidateRows) {
      const values = candidates.get(row.source_block_id) ?? [];
      values.push({
        id: row.id,
        engine: row.engine,
        passName: row.pass_name,
        contentMarkdown: row.content_markdown,
        latex: row.latex,
        confidence: numberOrNull(row.confidence),
        metadata: row.metadata,
        createdAt: row.created_at,
      });
      candidates.set(row.source_block_id, values);
    }
    return {
      ...toPageSummary(page),
      width: typeof page.extraction_metadata.width === 'number'
        ? page.extraction_metadata.width : null,
      height: typeof page.extraction_metadata.height === 'number'
        ? page.extraction_metadata.height : null,
      blocks: blocks.rows.map((row) => ({
        id: row.id,
        pageId: row.source_page_id,
        sequenceNumber: row.sequence_number,
        blockType: row.block_type,
        boundingBox: row.bounding_box,
        confidence: numberOrNull(row.confidence),
        reviewState: row.review_state,
        reviewReasons: row.review_reasons,
        contentMarkdown: row.current_content_markdown,
        candidates: candidates.get(row.id) ?? [],
      })),
    };
  }

  async getBlockImageReference(blockId: string): Promise<SourceBlockImageReference> {
    const result = await this.pool.query<BlockRow & { page_image_key: string | null }>(
      `SELECT b.id, b.source_page_id, b.sequence_number, b.block_type, b.bounding_box,
              b.confidence, b.review_state, b.review_reasons, b.current_content_markdown,
              p.page_image_key
       FROM source_blocks b JOIN source_pages p ON p.id = b.source_page_id
       WHERE b.id = $1 AND b.deleted_at IS NULL`, [blockId],
    );
    const row = result.rows[0];
    if (row === undefined || row.page_image_key === null) {
      throw new Error(`Source block ${blockId} was not found.`);
    }
    return {
      imagePath: row.page_image_key,
      block: {
        id: row.id, pageId: row.source_page_id, sequenceNumber: row.sequence_number,
        blockType: row.block_type, boundingBox: row.bounding_box,
        confidence: numberOrNull(row.confidence), reviewState: row.review_state,
        reviewReasons: row.review_reasons, contentMarkdown: row.current_content_markdown,
        candidates: [],
      },
    };
  }

  async updateBlockLayout(blockId: string, input: BlockLayoutInput): Promise<void> {
    const result = await this.pool.query(
      `UPDATE source_blocks SET sequence_number = $2, block_type = $3,
         bounding_box = $4::jsonb, review_state = 'pending', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL`,
      [blockId, input.sequenceNumber, input.blockType, JSON.stringify(input.boundingBox)],
    );
    if (result.rowCount === 0) throw new Error(`Source block ${blockId} was not found.`);
  }

  async createBlock(
    pageId: string,
    input: BlockLayoutInput & { contentMarkdown: string },
  ): Promise<string> {
    const found = await this.pool.query<{ extraction_run_id: string }>(
      `SELECT active_extraction_run_id AS extraction_run_id FROM source_pages
       WHERE id = $1 AND active_extraction_run_id IS NOT NULL`, [pageId],
    );
    const runId = found.rows[0]?.extraction_run_id;
    if (runId === undefined) throw new Error(`Page ${pageId} has no extraction run.`);
    const blockId = randomUUID();
    await this.pool.query(
      `INSERT INTO source_blocks
         (id, source_page_id, extraction_run_id, source_key, sequence_number,
          block_type, bounding_box, review_state, review_reasons, current_content_markdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending',
         '["manually_added"]'::jsonb, $8)`,
      [blockId, pageId, runId, `manual-${blockId}`, input.sequenceNumber,
        input.blockType, JSON.stringify(input.boundingBox), input.contentMarkdown],
    );
    await this.pool.query(
      `INSERT INTO source_block_candidates
         (id, source_block_id, engine, pass_name, content_markdown, latex, confidence, metadata)
       VALUES ($1, $2, 'manual', 'created', $3, NULL, NULL, '{}'::jsonb)`,
      [randomUUID(), blockId, input.contentMarkdown],
    );
    return blockId;
  }

  async deleteBlock(blockId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE source_blocks SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL`, [blockId],
    );
    if (result.rowCount === 0) throw new Error(`Source block ${blockId} was not found.`);
  }

  async reviewBlock(blockId: string, input: BlockReviewInput): Promise<void> {
    const reviewState: SourceReviewState = input.decision === 'reject'
      ? 'rejected' : 'approved';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE source_blocks SET review_state = $2, current_content_markdown = $3,
           updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL`,
        [blockId, reviewState, input.contentMarkdown],
      );
      if (updated.rowCount === 0) throw new Error(`Source block ${blockId} was not found.`);
      await client.query(
        `INSERT INTO source_block_reviews
           (id, source_block_id, decision, content_markdown, reviewer, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), blockId, input.decision, input.contentMarkdown,
          input.reviewer, input.notes],
      );
      await client.query('COMMIT');
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizePage(pageId: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM source_blocks
         WHERE source_page_id = $1 AND deleted_at IS NULL AND block_type <> 'footer'
           AND extraction_run_id = (SELECT active_extraction_run_id FROM source_pages WHERE id = $1)
           AND review_state = 'pending'`, [pageId],
      );
      if (Number(pending.rows[0]!.count) > 0) {
        throw new Error(
          'Every meaningful block must be approved or rejected before finalization.',
        );
      }
      const accepted = await client.query<{ current_content_markdown: string }>(
        `SELECT current_content_markdown FROM source_blocks
         WHERE source_page_id = $1 AND deleted_at IS NULL AND block_type <> 'footer'
           AND extraction_run_id = (SELECT active_extraction_run_id FROM source_pages WHERE id = $1)
           AND review_state = 'approved' ORDER BY sequence_number, id`, [pageId],
      );
      const extractedText = accepted.rows
        .map((row) => row.current_content_markdown.trim())
        .filter(Boolean)
        .join('\n\n');
      const result = await client.query(
        `UPDATE source_pages SET extracted_text = $2, verified_at = CURRENT_TIMESTAMP,
           extraction_metadata = extraction_metadata ||
             '{"structuredReviewStatus":"verified"}'::jsonb WHERE id = $1`,
        [pageId, extractedText],
      );
      if (result.rowCount === 0) throw new Error(`Source page ${pageId} was not found.`);
      await client.query('COMMIT');
      return extractedText;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
