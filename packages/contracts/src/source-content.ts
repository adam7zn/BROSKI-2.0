import { z } from 'zod';

export const sourceBlockTypeSchema = z.enum([
  'heading',
  'prose',
  'formula',
  'example',
  'exercise',
  'solution',
  'graph',
  'table',
  'image',
  'contents',
  'footer',
]);

export const sourceReviewStateSchema = z.enum([
  'pending',
  'approved',
  'rejected',
]);

export const sourceBoundingBoxSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(
    ([x, y, width, height]) =>
      x >= 0 &&
      y >= 0 &&
      width > 0 &&
      height > 0 &&
      x + width <= 1.000_001 &&
      y + height <= 1.000_001,
    'Bounding box must fit within normalized top-left page coordinates',
  );

export const sourceCandidateSchema = z
  .object({
    engine: z.enum(['apple_vision', 'pix2tex', 'manual']),
    passName: z.string().min(1),
    contentMarkdown: z.string(),
    latex: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const extractedSourceBlockSchema = z
  .object({
    sourceKey: z.string().min(1),
    sequenceNumber: z.number().int().positive(),
    blockType: sourceBlockTypeSchema,
    boundingBox: sourceBoundingBoxSchema,
    confidence: z.number().min(0).max(1).nullable(),
    reviewReasons: z.array(z.string().min(1)),
    candidates: z.array(sourceCandidateSchema).min(1),
  })
  .strict();

export const extractedSourcePageSchema = z
  .object({
    filePageNumber: z.number().int().positive(),
    printedPageNumber: z.string().nullable(),
    imagePath: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    blocks: z.array(extractedSourceBlockSchema),
  })
  .strict();

export const structuredExtractionSchema = z
  .object({
    schemaVersion: z.literal(1),
    pipelineVersion: z.string().min(1),
    documentTitle: z.string().min(1),
    inputChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    configuration: z.record(z.string(), z.unknown()),
    pages: z.array(extractedSourcePageSchema).min(1),
  })
  .strict();

export const blockReviewInputSchema = z
  .object({
    decision: z.enum(['approve', 'correct', 'reject']),
    contentMarkdown: z.string(),
    reviewer: z.string().min(1).default('william'),
    notes: z.string().max(2_000).nullable().default(null),
  })
  .strict();

export const blockLayoutInputSchema = z
  .object({
    sequenceNumber: z.number().int().positive(),
    blockType: sourceBlockTypeSchema,
    boundingBox: sourceBoundingBoxSchema,
  })
  .strict();

export type BlockLayoutInput = z.infer<typeof blockLayoutInputSchema>;
export type BlockReviewInput = z.infer<typeof blockReviewInputSchema>;
export type ExtractedSourceBlock = z.infer<typeof extractedSourceBlockSchema>;
export type ExtractedSourcePage = z.infer<typeof extractedSourcePageSchema>;
export type SourceBlockType = z.infer<typeof sourceBlockTypeSchema>;
export type SourceBoundingBox = z.infer<typeof sourceBoundingBoxSchema>;
export type SourceCandidate = z.infer<typeof sourceCandidateSchema>;
export type SourceReviewState = z.infer<typeof sourceReviewStateSchema>;
export type StructuredExtraction = z.infer<typeof structuredExtractionSchema>;
