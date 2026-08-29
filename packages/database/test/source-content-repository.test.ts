import { createHash } from 'node:crypto';

import type { StructuredExtraction } from '@math-study-companion/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresSourceContentRepository,
  runMigrations,
} from '../src/index.js';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres@127.0.0.1:54329/math_study_companion';
const extraction: StructuredExtraction = {
  schemaVersion: 1,
  pipelineVersion: 'test-v1',
  documentTitle: 'Test chapter',
  inputChecksum: createHash('sha256').update('structured-test').digest('hex'),
  configuration: { externalRequests: false },
  pages: [
    {
      filePageNumber: 1,
      printedPageNumber: '9',
      imagePath: '/tmp/page-009.jpg',
      width: 1000,
      height: 1500,
      blocks: [
        {
          sourceKey: 'page-1-block-1',
          sequenceNumber: 1,
          blockType: 'prose',
          boundingBox: [0.1, 0.1, 0.8, 0.2],
          confidence: 0.95,
          reviewReasons: [],
          candidates: [
            {
              engine: 'apple_vision',
              passName: 'original',
              contentMarkdown: 'Algebraiska uttryck',
              latex: null,
              confidence: 0.95,
              metadata: {},
            },
          ],
        },
      ],
    },
  ],
};

describe.skipIf(process.env.TEST_DATABASE_URL === undefined)(
  'PostgresSourceContentRepository',
  () => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresSourceContentRepository(pool);
    beforeAll(async () => runMigrations(pool));
    afterAll(async () => pool.end());

    it('imports idempotently and leaves every block pending', async () => {
      const first = await repository.importExtraction(extraction);
      const second = await repository.importExtraction(extraction);
      expect(second.documentId).toBe(first.documentId);
      expect(second.runId).toBe(first.runId);
      const pages = await repository.listPages(first.documentId);
      expect(pages).toHaveLength(1);
      const page = await repository.getPage(pages[0]!.id);
      expect(page.blocks).toHaveLength(1);
      expect(page.blocks[0]?.reviewState).toBe('pending');
      expect(page.verifiedAt).toBeNull();
    });

    it('cannot finalize pending content and assembles only approved blocks', async () => {
      const imported = await repository.importExtraction(extraction);
      const page = (await repository.listPages(imported.documentId))[0]!;
      const detail = await repository.getPage(page.id);
      await expect(repository.finalizePage(page.id)).rejects.toThrow(
        'Every meaningful block',
      );
      await repository.reviewBlock(detail.blocks[0]!.id, {
        decision: 'correct',
        contentMarkdown: 'Korrigerad åäö',
        reviewer: 'test',
        notes: null,
      });
      await expect(repository.finalizePage(page.id)).resolves.toBe(
        'Korrigerad åäö',
      );
      await expect(repository.getPage(page.id)).resolves.toMatchObject({
        verifiedAt: expect.any(Date),
      });
    });

    it('keeps candidate and review evidence append-only', async () => {
      const imported = await repository.importExtraction(extraction);
      const page = await repository.getPage(
        (await repository.listPages(imported.documentId))[0]!.id,
      );
      await repository.reviewBlock(page.blocks[0]!.id, {
        decision: 'approve',
        contentMarkdown: 'Algebraiska uttryck',
        reviewer: 'test',
        notes: null,
      });
      await expect(
        pool.query(
          `UPDATE source_block_candidates SET content_markdown = 'changed'`,
        ),
      ).rejects.toThrow('append-only');
      await expect(
        pool.query(`DELETE FROM source_block_reviews`),
      ).rejects.toThrow('append-only');
    });
  },
);
