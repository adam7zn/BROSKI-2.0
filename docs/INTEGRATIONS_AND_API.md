# Integrations and API Contracts

## 1. Integration strategy

All external systems are adapters behind internal contracts. The core learning engine must remain unaware of provider SDKs and raw external payloads.

```text
External payload → provider adapter → normalized domain event → application service
```

## 2. Canvas integration

### Purpose

Canvas supplies teacher intent and course timing, not the complete mathematical knowledge base.

### Desired data

- course name and ID;
- modules and module items;
- assignments and due dates;
- calendar events;
- pages or syllabus entries containing lesson plans;
- assessment dates and coverage text;
- links or attachments relevant to the course.

### Internal interface

```ts
interface CourseSourceProvider {
  syncCourse(input: SyncCourseInput): Promise<SyncCourseResult>;
  getCourseSnapshot(courseId: string, asOf: Date): Promise<CourseSnapshot>;
}
```

### Normalization rules

- Preserve external IDs.
- Preserve the last raw source snapshot or stable hash.
- Convert dates to UTC at storage boundaries.
- Tag deleted/changed source items rather than silently losing history.
- Distinguish scheduled lesson time from assignment due time.
- Store source freshness.
- Do not let a model rewrite Canvas source text in place.

### MVP fallback

If direct access is delayed, accept a manually exported or copied lesson plan through the same normalized import contract. The learning engine should not care whether the timeline came from API sync or manual import.

## 3. Textbook integration

### Inputs

- original textbook file;
- optional answer key or solution material;
- optional manual table of contents;
- manual corrections.

### Import command

```text
POST /internal/imports/textbook
or
pnpm import:textbook --file <path> --course <course-id>
```

### Output contract

```ts
interface TextbookImportResult {
  documentId: string;
  checksum: string;
  pageCount: number;
  chunksCreated: number;
  exercisesCreated: number;
  conceptsLinked: number;
  reviewFlags: ImportReviewFlag[];
}
```

### Retrieval interface

```ts
interface ContentRepository {
  retrieveText(input: {
    courseId: string;
    conceptIds?: string[];
    query?: string;
    chunkTypes?: ChunkType[];
    limit: number;
  }): Promise<RetrievedChunk[]>;

  findExercises(input: {
    conceptIds: string[];
    difficulty?: Difficulty;
    excludeExerciseIds?: string[];
    requireVerifiedAnswer: boolean;
    limit: number;
  }): Promise<Exercise[]>;
}
```

## 4. Messaging integration

### Provider-neutral contract

```ts
interface MessagingProvider {
  sendMessage(input: {
    conversationId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<{
    providerMessageId: string;
    acceptedAt: string;
  }>;

  sendImage(input: {
    conversationId: string;
    mediaUrl: string;
    altText: string;
    caption?: string;
    idempotencyKey: string;
  }): Promise<{
    providerMessageId: string;
    acceptedAt: string;
  }>;

  normalizeWebhook(payload: unknown, headers: Record<string, string>): Promise<InboundMessageEvent[]>;
}
```

### Normalized inbound event

```ts
interface InboundMessageEvent {
  provider: string;
  providerEventId: string;
  providerMessageId: string;
  providerConversationId: string;
  senderAddress: string;
  receivedAt: string;
  type: "TEXT" | "IMAGE" | "REACTION" | "DELIVERY_STATUS";
  text?: string;
  media?: Array<{ url: string; mimeType?: string }>;
  rawPayloadHash: string;
}
```

### Provider selection rule

Select the first provider only after a thin spike verifies:

- proactive outbound messages;
- inbound replies;
- image support;
- delivery reliability;
- acceptable operational setup for one user;
- clear separation between personal and service Apple IDs/phone numbers where relevant.

Document the final choice in an ADR. Do not couple domain code to Beeper, BlueBubbles, Sendblue, or another provider name.

## 5. Internal application API

The exact framework is open, but the following routes/commands define the boundaries.

### Health and operations

```text
GET  /health
GET  /ready
POST /internal/canvas/sync
POST /internal/imports/textbook
POST /internal/state/rebuild
POST /internal/scheduler/run
```

### Current context

```text
GET /internal/students/:studentId/context
```

Response:

```ts
interface StudentContextResponse {
  context: StudentContext;
  builtAt: string;
  sourceFreshness: {
    canvasLastSyncedAt?: string;
    textbookVersion?: number;
  };
}
```

### Planning

```text
POST /internal/agent/plan
```

Request:

```ts
interface PlanningRequest {
  studentId: string;
  trigger: {
    type: "BEFORE_LESSON" | "AFTER_LESSON" | "REVIEW_SCAN" | "ASSESSMENT_SCAN" | "MANUAL";
    referenceId?: string;
    occurredAt: string;
  };
  dryRun: boolean;
}
```

Response:

```ts
interface PlannedInteraction {
  action: "SEND" | "NO_ACTION";
  mode?: StudyMode;
  reason: string;
  evidenceRefs: string[];
  dueAt?: string;
  studyItems?: StudyItem[];
  constraintsApplied: string[];
  plannerVersion: string;
}
```

### Delivery

```text
POST /internal/interactions/:interactionId/send
POST /internal/interactions/:interactionId/cancel
```

### Messaging webhook

```text
POST /webhooks/messaging/:provider
```

The Phase 3 hosted route is `POST /webhooks/messaging/sendblue`. It compares the
`sb-signing-secret` header in constant time, strictly normalizes message webhooks, allowlists the
single configured participant and Sendblue line, and durably deduplicates by `message_handle`
before acknowledging with 2xx. `SENT`, `DELIVERED`, and `ERROR` are stored as normalized delivery
events. Because Sendblue cannot disable automatic SMS fallback, every outbound send first calls its
service lookup and proceeds only for `iMessage`; SMS/RCS service or `was_downgraded: true` in the
send response or webhook then fails the session closed.

Rules:

- verify signature/authentication when supported;
- normalize before business logic;
- deduplicate before evaluation;
- return provider-required success quickly;
- perform slow evaluation asynchronously if needed.

Hosted operator routes use `Authorization: Bearer <INTERNAL_API_TOKEN>`. The existing start route is
unchanged; `POST /internal/demo/:interactionId/launch` creates the messaging session and queues the
first validated `ConversationAgent` output. `GET /internal/demo/:interactionId/messaging` exposes
operational metadata without message content.

`GET /internal/messaging/status` returns only `{ provider, liveEnabled, availability }`.
`availability` is `null` unless `verifyProvider=true`; with that flag the adapter performs a
read-only `/api/evaluate-service` lookup and fails closed unless Sendblue reports `iMessage`.

The Phase 4 manual verified-exercise routes use the same bearer boundary:

```text
GET  /internal/exercises
POST /internal/exercises/:exerciseId/start?interactionId=<fresh-id>
POST /internal/demo/:interactionId/launch
```

The list returns provenance and difficulty metadata for `verified` rows only; it omits prompts,
answers, solutions, and rubrics. The start route rejects missing, draft, and rejected IDs, stores an
immutable interaction-to-exercise reference, and uses the approved prompt byte-for-byte as the
interaction source text. The existing canonical `/internal/demo/start` remains backward-compatible.

`CONVERSATION_AGENT_PROVIDER=deterministic|anthropic` selects the hosted behavior and defaults to
`deterministic`. Anthropic mode requires `ANTHROPIC_API_KEY`, uses `MSC_MODEL` (default
`claude-sonnet-5`), and has no silent deterministic fallback. Claude receives only the selected
prompt, expected answer, rubric, and bounded transcript. It does not receive the page image,
surrounding textbook page, or complete book. A timeout, rate limit, or schema-invalid response
preserves the claimed inbound evidence, fails the turn, and creates no feedback outbox row.

After completion, the latest completed verified-exercise session remains routable for related
questions about that exercise. Each reply is a normal durable inbox/outbox turn, the session stays
completed, and the accepted result is never rewritten. Claude receives the same bounded exercise
context and recent transcript. Unrelated or low-confidence requests receive a fixed boundary; a
provider failure still fails closed without invented feedback. Starting a new exercise remains an
explicit authenticated action. A failed follow-up does not erase or permanently stop the completed
exercise session; a later provider event can recover it while the failed inbound evidence remains.

The smarter agent adapter must implement this exact in-process boundary:

```ts
interface ConversationAgent {
  startSession(input: AgentSessionStartInput): Promise<ConversationAgentOutput>;
  handleInbound(input: AgentInboundTurnInput): Promise<ConversationAgentOutput>;
}
```

Each output is runtime-validated before persistence. A completed inbound turn must include one
result whose `interactionId` matches the durable session. The agent may return message intents,
profile evidence, state, and a result; it never sends a provider request or writes PostgreSQL.

### Evaluation

```text
POST /internal/attempts/evaluate
```

Request:

```ts
interface EvaluationRequest {
  interactionId: string;
  studyItemId: string;
  studentId: string;
  rawResponse: string;
  receivedAt: string;
}
```

Response:

```ts
interface EvaluationResult {
  correctness?: number;
  confidence: number;
  normalizedAnswer?: unknown;
  feedback: string;
  needsMoreEvidence: boolean;
  followUpItem?: StudyItem;
  conceptEvidence: Array<{
    conceptId: string;
    type: "POSITIVE" | "NEGATIVE" | "UNCERTAIN";
    strength: number;
  }>;
  misconceptionEvidence: Array<{
    code: string;
    conceptId: string;
    confidence: number;
  }>;
  reviewUpdates: ReviewScheduleUpdate[];
  evaluatorVersion: string;
}
```

## 6. Scheduler contracts

### Candidate job key examples

```text
before-lesson:<studentId>:<lessonId>:<offsetMinutes>
after-lesson:<studentId>:<lessonId>:<window>
review-scan:<studentId>:<localDate>:<window>
assessment-scan:<studentId>:<assessmentId>:<daysBefore>
```

The key must be stored before sending. Re-running a scheduler tick must not produce another outbound interaction with the same key.

## 7. Model adapter

```ts
interface ModelProvider {
  generateStructured<T>(input: {
    task: string;
    schemaName: string;
    schemaVersion: string;
    systemPromptVersion: string;
    context: unknown;
    timeoutMs: number;
  }): Promise<{
    output: T;
    model: string;
    usage?: ModelUsage;
    rawResponseId?: string;
  }>;
}
```

No package outside the model adapter should depend on one provider's raw response format.

## 8. Event types

Recommended internal events:

```text
SOURCE_SYNC_COMPLETED
LESSON_MAPPING_CHANGED
REVIEW_BECAME_DUE
INTERACTION_PLANNED
INTERACTION_SENT
MESSAGE_RECEIVED
ATTEMPT_RECORDED
ATTEMPT_EVALUATED
CONCEPT_STATE_UPDATED
INTERACTION_COMPLETED
MESSAGE_DELIVERY_FAILED
```

The MVP may implement these as database records and function calls rather than a message broker.

## 9. Error contract

All internal errors should include:

```ts
interface AppErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  traceId: string;
  details?: Record<string, unknown>;
}
```

Do not expose provider credentials, raw private source data, or model prompts in external error responses.
