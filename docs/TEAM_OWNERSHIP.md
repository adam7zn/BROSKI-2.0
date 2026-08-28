# Two-Person Team Ownership

> **Current-phase note:** [Delivery phases](PHASES.md) is authoritative through the first real-message demo. During those phases, Person A owns messaging and the simple agent; Person B owns the backend, data, images, files, operations, and deployment. The broader split below is a later-stage option, not the starting plan.

## 1. Recommended split

The cleanest two-person split is between product intelligence and platform delivery. This keeps most day-to-day work independent while giving the system one explicit integration boundary.

| Person | Workstream | Owns the answer to |
|---|---|---|
| Person A | Course and learning intelligence | “What does the course say, what should William do next, and what did his answer mean?” |
| Person B | Platform and delivery | “How is state stored, scheduled, delivered, and operated reliably?” |

Replace Person A and Person B with names once assigned.

## 2. Person A — Course and learning intelligence

### Primary ownership

- textbook import, parsing, and content verification;
- page, section, concept, prerequisite, and exercise structure;
- source provenance and lesson-to-source mapping;
- Canvas content import and synchronization behavior;
- lesson and assessment timeline interpretation;
- `StudentContext` interpretation;
- study-mode, review-priority, and interval logic;
- question selection, adaptation, and generation;
- deterministic answer normalization where feasible;
- model-based evaluation rubrics and feedback;
- misconception evidence and mastery estimates;
- visual-selection policy and learning prompts;
- content QA, manual correction tools, and prompt regression fixtures.

### Main code areas

```text
packages/ingestion/
packages/learning-engine/
fixtures/textbook/
fixtures/canvas/
fixtures/learning/
course, content, and learning admin views
```

### Published contracts

- `SourceDocument`
- `SourcePage`
- `TextChunk`
- `Concept`
- `Exercise`
- `Lesson`
- `Assessment`
- `CourseSnapshot`
- `PlanningRequest`
- `PlannedInteraction`
- `StudyItem`
- `EvaluationRequest`
- `EvaluationResult`
- `ConceptStateUpdate`
- `ReviewScheduleUpdate`

### Definition of success

Given a date, lesson, or valid `StudentContext`, the system can identify the correct course material, choose a verified learning action or `NO_ACTION`, and convert William's response into traceable feedback and state updates.

## 3. Person B — Platform and delivery

### Primary ownership

- PostgreSQL schema and migrations;
- repositories and transaction boundaries;
- API and webhook server;
- worker and scheduler;
- messaging-provider interface and implementation;
- Canvas credentials and sync execution;
- object storage and embedding-job infrastructure;
- authentication and secrets;
- idempotency and delivery retries;
- deployment and environments;
- observability and agent-run tracing;
- feature flags;
- admin shell and operational controls;
- deterministic visual rendering and media delivery.

### Main code areas

```text
packages/contracts/
packages/db/
packages/messaging/
packages/observability/
apps/api/
apps/worker/
apps/admin/
infrastructure/
```

### Published contracts

- `MessagingProvider`
- normalized message events;
- persistence repositories;
- scheduler trigger payloads;
- import and synchronization job interfaces;
- agent-run trace format;
- admin commands.

### Definition of success

The system stores every event, invokes the course and learning functions with valid inputs, sends and receives each message once, exposes useful traces, and can be paused, recovered, and deployed safely.

## 4. Shared ownership

### `packages/contracts`

Person B maintains package structure, builds, and version discipline. Domain meaning is shared:

- Person A approves course, source, planning, and evaluation semantics;
- Person B approves persistence, runtime, and delivery semantics;
- any contract crossing the boundary requires both approvals.

### Product behavior

Both people review the weekly end-to-end demo, pilot feedback, privacy changes, and autonomous-messaging policy. The PRD changes only through an explicit product decision, not as a side effect of implementation.

### Review coverage

Each person is the default reviewer for changes in the other person's workstream when the change affects shared contracts, user-visible behavior, security, or production operations. Small internal refactors can merge without cross-review when contracts and behavior remain unchanged.

## 5. Interface that enables parallel work

The main boundary is a domain service implemented by Person A and orchestrated by Person B.

### Person A publishes course and learning behavior

```ts
interface CourseIntelligence {
  getSnapshot(asOf: string): Promise<CourseSnapshot>;
  getConcept(id: string): Promise<Concept>;
  getConceptSources(id: string): Promise<SourceRef[]>;
  findExercises(input: ExerciseQuery): Promise<Exercise[]>;
  retrieveText(input: RetrievalQuery): Promise<RetrievedChunk[]>;
}

interface LearningEngine {
  plan(input: PlanningRequest): Promise<PlannedInteraction>;
  evaluate(input: EvaluationRequest): Promise<EvaluationResult>;
}
```

Person B can build orchestration against fixtures and fake outputs before the real ingestion and learning logic is complete.

### Person B publishes persistence and runtime services

```ts
interface UnitOfWork {
  students: StudentRepository;
  courses: CourseRepository;
  content: ContentRepository;
  attempts: AttemptRepository;
  interactions: InteractionRepository;
  agentRuns: AgentRunRepository;
}

interface RuntimeServices {
  messaging: MessagingProvider;
  scheduler: Scheduler;
  storage: ObjectStorage;
  traces: TraceWriter;
}
```

Person A can develop against in-memory repositories and runtime fixtures before production infrastructure is ready.

Neither person should bypass these interfaces by importing the other workstream's internal modules or writing SQL from domain packages.

## 6. First two weeks of parallel work

### Week 1

**Person A**

- create sample textbook, Canvas, and learning fixtures;
- draft the concept taxonomy for the current chapter;
- define planning and evaluation schemas;
- implement a deterministic review-interval baseline;
- implement the planner against fixtures;
- create 20 golden learning cases;
- produce one verified `CourseSnapshot` fixture.

**Person B**

- initialize the monorepo and CI;
- implement schema, migrations, and repository interfaces;
- build the fake messaging provider and webhook loop;
- create API and worker shells;
- create the admin shell and trace viewer;
- provide in-memory adapters for Person A.

### Week 2

**Person A**

- expand textbook extraction;
- implement Canvas normalization and course mapping;
- map the next two course weeks to concepts;
- select and verify textbook exercises;
- implement response evaluation for current topics;
- implement misconception evidence and feedback;
- integrate with Person B's repositories.

**Person B**

- wire worker orchestration;
- implement active-interaction state and idempotency;
- implement secure Canvas sync execution;
- add the real messaging adapter behind a feature flag;
- deploy a private test environment;
- connect traces and operational controls.

### Week 2 demo

A manually initiated real-message question based on the next lesson is answered by William, evaluated, persisted, and reflected in the next review state.

## 7. Workload and handoff rules

- Plan work in vertical pilot slices, not by completing an entire workstream at once.
- Person A delivers fixtures and contract examples before implementation details.
- Person B delivers in-memory or fake adapters before production integrations.
- Contract changes land before dependent implementation changes.
- Shared fixtures are append-only where practical.
- Generated files and database migrations have one author per change.
- If one person is blocked, use a fixture, stub, or compatibility adapter before transferring ownership.
- Rebalance operational or content-QA tasks weekly if either person's queue is more than one milestone ahead of the other.

## 8. Avoiding merge conflicts

- Person A does not call messaging SDKs, own webhooks, or encode delivery behavior in learning logic.
- Person B does not encode learning decisions in scheduler jobs or alter domain meaning inside repositories.
- Both people use published interfaces rather than importing internal modules across the workstream boundary.
- Changes spanning both workstreams are split into a contract change followed by one implementation change per owner.

## 9. Lightweight status format

Each person posts:

```text
Completed:
Next:
Blocked by:
Contract change needed: yes/no
Review needed from:
```

A blocker older than one working day should be replaced by a fixture, stub, or temporary compatibility layer so parallel work can continue.
