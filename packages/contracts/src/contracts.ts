import { z } from 'zod';

const requiredString = z.string().min(1);

export const demoInteractionIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

export const studyModeSchema = z.enum(['PREPARE', 'PRACTISE', 'REVIEW']);

/**
 * How one answered interaction ended. `unclear` means the evaluator could not
 * tell what the student meant; it is not a wrong answer and must not be stored
 * as one (`docs/RULES.md` §2.8). The wire payload types `result` as a plain
 * string, so this enum is what keeps the four values honest either side of it.
 */
export const interactionResultSchema = z.enum([
  'correct',
  'partially_correct',
  'incorrect',
  'unclear',
]);

export const demoSelfAssessedLevelSchema = z.enum([
  'struggling',
  'okay',
  'confident',
]);

export const demoProfileInputSchema = z
  .object({
    course: z.string().trim().min(1).max(80),
    selfAssessedLevel: demoSelfAssessedLevelSchema,
    previousGrade: z.string().trim().min(1).max(20).nullable(),
  })
  .strict();

export const demoMessageDirectionSchema = z.enum(['inbound', 'outbound']);

export const demoMessageEventTypeSchema = z.enum([
  'accepted',
  'received',
  'failed',
]);

export const demoOutboundReservationInputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(160),
  })
  .strict();

export const demoMessageEventInputSchema = z
  .object({
    provider: z.string().trim().min(1).max(40),
    direction: demoMessageDirectionSchema,
    eventType: demoMessageEventTypeSchema,
    providerEventId: z.string().trim().min(1).max(200).nullable(),
    providerMessageId: z.string().trim().min(1).max(200).nullable(),
    idempotencyKey: z.string().trim().min(1).max(160).nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.direction === 'inbound' && event.providerEventId === null) {
      context.addIssue({
        code: 'custom',
        path: ['providerEventId'],
        message: 'Inbound events require a provider event ID',
      });
    }
    if (event.direction === 'outbound' && event.idempotencyKey === null) {
      context.addIssue({
        code: 'custom',
        path: ['idempotencyKey'],
        message: 'Outbound events require an idempotency key',
      });
    }
  });

export const backendToConversationSchema = z
  .object({
    interactionId: demoInteractionIdSchema,
    topic: requiredString,
    sourceText: requiredString,
    difficulty: requiredString,
    image: requiredString.nullable(),
    mode: studyModeSchema.default('PRACTISE'),
    reason: requiredString.default('Manual judge MVP demonstration'),
  })
  .strict();

export type BackendToConversation = z.infer<typeof backendToConversationSchema>;

export const conversationToBackendSchema = z
  .object({
    interactionId: demoInteractionIdSchema,
    question: requiredString,
    studentReply: requiredString,
    feedback: requiredString,
    result: requiredString,
  })
  .strict();

export type ConversationToBackend = z.infer<typeof conversationToBackendSchema>;
export type DemoMessageDirection = z.infer<typeof demoMessageDirectionSchema>;
export type DemoMessageEventInput = z.infer<typeof demoMessageEventInputSchema>;
export type DemoMessageEventType = z.infer<typeof demoMessageEventTypeSchema>;
export type DemoOutboundReservationInput = z.infer<
  typeof demoOutboundReservationInputSchema
>;
export type DemoProfileInput = z.infer<typeof demoProfileInputSchema>;
export type DemoSelfAssessedLevel = z.infer<typeof demoSelfAssessedLevelSchema>;
export type InteractionResult = z.infer<typeof interactionResultSchema>;
export type StudyMode = z.infer<typeof studyModeSchema>;
