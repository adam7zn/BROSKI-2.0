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

export const exerciseDifficultySchema = z.enum(['easy', 'medium', 'hard']);
export const exerciseIdSchema = z.uuid();

export const exerciseGradingStrategySchema = z.enum([
  'numeric',
  'symbolic',
  'multiple_choice',
  'rubric',
]);

export const exerciseVerificationStateSchema = z.enum([
  'draft',
  'verified',
  'rejected',
]);

export const exerciseAnswerPayloadSchema = z
  .object({
    canonical: z.string().trim().min(1).max(2_000),
    accepted: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
  })
  .strict();

const exerciseContentSchema = z
  .object({
    sourcePageId: z.uuid(),
    sourceBlockId: z.uuid().nullable().default(null),
    sourceBoundingBox: sourceBoundingBoxSchema,
    sectionCode: z.string().trim().min(1).max(20),
    sectionTitle: z.string().trim().min(1).max(120),
    exerciseNumber: z.string().trim().min(1).max(40),
    partLabel: z.string().trim().max(20),
    topic: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(1).max(18_996),
    answerPayload: exerciseAnswerPayloadSchema,
    solutionText: z.string().trim().min(1).max(18_996),
    rubric: z.string().trim().min(1).max(4_000),
    difficulty: exerciseDifficultySchema,
    gradingStrategy: exerciseGradingStrategySchema,
  })
  .strict();

export const exerciseDraftInputSchema = exerciseContentSchema;

export const exerciseReviewInputSchema = z
  .object({
    decision: z.enum(['approve', 'correct', 'reject']),
    reviewer: z.string().trim().min(1).max(120).default('william'),
    notes: z.string().trim().max(2_000).nullable().default(null),
    correction: exerciseContentSchema.nullable().default(null),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.decision === 'correct' && review.correction === null) {
      context.addIssue({
        code: 'custom',
        path: ['correction'],
        message: 'A correction review requires the corrected exercise',
      });
    }
    if (review.decision !== 'correct' && review.correction !== null) {
      context.addIssue({
        code: 'custom',
        path: ['correction'],
        message: 'Only a correction review may replace exercise content',
      });
    }
  });

export const pilotExerciseDraftItemSchema = exerciseContentSchema
  .omit({ sourcePageId: true, sourceBlockId: true })
  .extend({
    printedPageNumber: z.string().trim().min(1).max(40),
    sourceBlockSequenceNumber: z.number().int().positive().nullable(),
  })
  .strict();

export const pilotExerciseDraftManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceDocumentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    sourceDocumentVersion: z.number().int().positive().default(1),
    exercises: z.array(pilotExerciseDraftItemSchema).length(20),
  })
  .strict()
  .superRefine((manifest, context) => {
    const expectedSections: Record<string, number> = {
      '1.1': 6,
      '1.2': 7,
      '1.3': 7,
    };
    const expectedDifficulties: Record<string, number> = {
      easy: 10,
      medium: 6,
      hard: 4,
    };
    for (const [sectionCode, expected] of Object.entries(expectedSections)) {
      const actual = manifest.exercises.filter(
        (exercise) => exercise.sectionCode === sectionCode,
      ).length;
      if (actual !== expected) {
        context.addIssue({
          code: 'custom',
          path: ['exercises'],
          message: `Pilot section ${sectionCode} requires ${expected} exercises; received ${actual}`,
        });
      }
    }
    for (const [difficulty, expected] of Object.entries(expectedDifficulties)) {
      const actual = manifest.exercises.filter(
        (exercise) => exercise.difficulty === difficulty,
      ).length;
      if (actual !== expected) {
        context.addIssue({
          code: 'custom',
          path: ['exercises'],
          message: `Pilot difficulty ${difficulty} requires ${expected} exercises; received ${actual}`,
        });
      }
    }
    const identities = new Set<string>();
    for (const [index, exercise] of manifest.exercises.entries()) {
      const identity = `${exercise.printedPageNumber}:${exercise.exerciseNumber}:${exercise.partLabel}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: 'custom',
          path: ['exercises', index],
          message: `Duplicate pilot exercise identity ${identity}`,
        });
      }
      identities.add(identity);
    }
  });

export const verifiedExerciseContextSchema = exerciseContentSchema
  .extend({
    exerciseId: exerciseIdSchema,
    sourceDocumentId: z.uuid(),
    printedPageNumber: z.string().trim().min(1).max(40),
    contentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    verificationState: z.literal('verified'),
    verifiedBy: z.string().trim().min(1).max(120),
    verifiedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const verifiedExerciseSummarySchema = verifiedExerciseContextSchema
  .pick({
    exerciseId: true,
    sourceDocumentId: true,
    sourcePageId: true,
    sourceBlockId: true,
    printedPageNumber: true,
    sectionCode: true,
    sectionTitle: true,
    exerciseNumber: true,
    partLabel: true,
    topic: true,
    difficulty: true,
    gradingStrategy: true,
    contentChecksum: true,
    verifiedBy: true,
    verifiedAt: true,
  })
  .strict();

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
export type ExerciseAnswerPayload = z.infer<typeof exerciseAnswerPayloadSchema>;
export type ExerciseDifficulty = z.infer<typeof exerciseDifficultySchema>;
export type ExerciseDraftInput = z.infer<typeof exerciseDraftInputSchema>;
export type ExerciseGradingStrategy = z.infer<
  typeof exerciseGradingStrategySchema
>;
export type ExerciseReviewInput = z.infer<typeof exerciseReviewInputSchema>;
export type ExerciseVerificationState = z.infer<
  typeof exerciseVerificationStateSchema
>;
export type PilotExerciseDraftItem = z.infer<
  typeof pilotExerciseDraftItemSchema
>;
export type PilotExerciseDraftManifest = z.infer<
  typeof pilotExerciseDraftManifestSchema
>;
export type ExtractedSourceBlock = z.infer<typeof extractedSourceBlockSchema>;
export type ExtractedSourcePage = z.infer<typeof extractedSourcePageSchema>;
export type SourceBlockType = z.infer<typeof sourceBlockTypeSchema>;
export type SourceBoundingBox = z.infer<typeof sourceBoundingBoxSchema>;
export type SourceCandidate = z.infer<typeof sourceCandidateSchema>;
export type SourceReviewState = z.infer<typeof sourceReviewStateSchema>;
export type StructuredExtraction = z.infer<typeof structuredExtractionSchema>;
export type VerifiedExerciseContext = z.infer<
  typeof verifiedExerciseContextSchema
>;
export type VerifiedExerciseSummary = z.infer<
  typeof verifiedExerciseSummarySchema
>;
