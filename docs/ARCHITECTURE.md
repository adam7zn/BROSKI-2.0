# Architecture Design

## 1. Architectural goals

The architecture must prove the timeline-aware learning loop with minimal operational complexity while keeping two owner workstreams independent:

- course and learning intelligence can publish course snapshots, plan interactions, and evaluate attempts using fixtures;
- platform and delivery can store, schedule, and transport structured interactions using fake domain responses.

The MVP uses one main learning engine with explicit modes. It does not require agent-to-agent orchestration.

## 2. System context

```text
Canvas/manual plan ──┐
                     ├──> Course intelligence ──┐
Textbook ────────────┘                          │
                                                v
Student attempts ───────> Learning engine <── Course snapshot
                              │   ^
                              v   │
                       Platform/API/jobs
                              │   ^
                              v   │
                        Messaging adapter
                              │   ^
                              v   │
                            William
```

## 3. Components

### 3.1 Course ingestion

Imports Canvas data or manual fixtures, normalizes lessons and assessments, records synchronization provenance, and publishes a dated `CourseSnapshot`.

### 3.2 Textbook ingestion and retrieval

Parses the permitted source into pages and chunks, identifies sections and exercises, maps them to stable concepts, and exposes provenance-preserving retrieval. Manual corrections override uncertain automated mappings.

### 3.3 Learning engine

Contains two pure, structured entry points:

- `planInteraction(context) -> PlannedInteraction | NoAction`
- `evaluateAttempt(studyItem, reply, context) -> AttemptEvaluation`

It selects between review, practice, preparation, diagnosis, teaching, assessment, and silence. Provider-specific transport and database calls do not belong inside this component.

### 3.4 Application API

Coordinates persistence and use cases such as viewing current context, planning an interaction, approving delivery, receiving a reply, evaluating an attempt, and replaying a failed run.

### 3.5 Scheduler and workers

Creates candidate planning jobs before/after lessons, for due reviews, and ahead of assessments. A candidate job does not imply that a message must be sent; the learning engine may return `NO_ACTION`.

Workers use deterministic job keys and transactional state transitions to prevent duplicate delivery.

### 3.6 Messaging adapter

Converts internal outbound messages into provider calls and normalizes inbound provider events. All provider identifiers are stored alongside internal conversation and message IDs.

### 3.7 Model adapter

Provides structured generation/evaluation, schema validation, timeout and retry policy, model metadata, and prompt-version tracking. Deterministic math checking is preferred when it can answer the question reliably.

### 3.8 Admin and observability

The MVP needs functional inspection rather than a polished dashboard. It must allow the team to inspect:

- source imports and uncertain mappings;
- current course snapshot;
- why a study item was planned;
- message delivery status;
- evaluation traces;
- student-concept evidence and review dates;
- failed or duplicate-suppressed jobs.

## 4. Primary data flows

### 4.1 Course synchronization

```text
Canvas/manual fixture
→ import run
→ normalize source records
→ upsert lessons and assessments
→ map concepts and textbook sources
→ publish versioned course snapshot
```

Failed imports never replace the last known-good snapshot.

### 4.2 Proactive planning and delivery

```text
scheduler trigger
→ acquire idempotent job
→ build StudentContext
→ learning engine plans
→ validate structured output
→ shadow-log, request approval, send, or do nothing
→ persist plan and delivery result
```

### 4.3 Reply and evaluation

```text
provider webhook
→ authenticate and deduplicate
→ normalize inbound event
→ identify conversation and active study item
→ store raw reply
→ deterministic/model evaluation
→ store attempt and concept evidence
→ recalculate review state
→ create and deliver feedback
```

Raw evidence is committed before derived mastery state.

## 5. Data architecture

PostgreSQL is the source of truth for course, content, learning, messaging, and operational state. `pgvector` may support semantic retrieval, while concept IDs, dates, relationships, and source provenance remain relational.

Object storage may hold permitted source documents, extracted page assets, and generated visuals. Secrets are stored outside the database in environment-specific secret management.

See [Data model](DATA_MODEL.md) for entity definitions.

## 6. Suggested repository structure

```text
apps/
  api/                    # HTTP API and provider webhooks
  worker/                 # scheduled and asynchronous jobs
  admin/                  # inspection and correction tools
packages/
  contracts/              # schemas shared by both workstreams
  database/               # migrations and repositories
  ingestion/              # Canvas and textbook import
  learning-engine/        # planning, evaluation, review logic
  messaging/              # provider-neutral messaging
  model-adapter/          # structured model calls
fixtures/
  canvas/
  textbook/
  learning/
docs/
```

TypeScript is the default application language. Heavy document extraction may use a separate Python utility if it provides a clear advantage, but it must publish the same versioned contracts.

## 7. Contract and versioning rules

- Shared payloads are runtime-validated, not TypeScript-only interfaces.
- Contract changes require fixtures and backward-compatibility consideration.
- Model outputs are treated as untrusted until schema validation succeeds.
- Every plan and evaluation stores the contract, prompt, and model versions used.
- Workstreams consume contracts through packages, not deep imports into another owner's implementation.

Detailed endpoints and integration interfaces are in [Integrations and API](INTEGRATIONS_AND_API.md).

## 8. Reliability design

- Inbound webhook events use provider event IDs for deduplication.
- Scheduled work uses stable keys derived from student, trigger type, and time window.
- Outbound messages use a unique idempotency key.
- Retries distinguish transient from permanent failures.
- State transitions are recorded before and after external calls.
- Quiet hours and send caps are enforced in the platform layer even when a plan requests delivery.
- A dead-letter or failed-run view supports manual replay.

## 9. Security boundaries

- Canvas and messaging credentials never enter prompts or logs.
- Webhook signatures are verified before processing.
- Source content is only sent to a model when necessary and permitted.
- Admin access is restricted to the pilot operators.
- Logs use internal IDs and redact answer or message content where full text is not required.

See [Security and privacy](SECURITY_PRIVACY.md).

## 10. Deployment stages

1. Local fixtures and deterministic tests.
2. Development database with manual triggers.
3. Shadow-mode scheduler with real course data but no sends.
4. Approval-mode messaging.
5. Limited live delivery with caps and quiet hours.
6. Normal personal pilot after evaluation gates pass.

The first deployment can run the API and worker together if that reduces overhead; their responsibilities should remain logically separate so they can later scale independently.

## 11. Architecture acceptance criteria

- Both workstreams can run against fixtures without waiting for live integrations.
- A single trace links trigger, plan, outbound message, reply, evaluation, and state update.
- Replaying a trigger or webhook does not duplicate a message or attempt.
- A failed source sync preserves last known-good course state.
- Provider adapters can be replaced without changing the learning engine.
- A historical attempt can be re-evaluated without destroying the original evidence.

