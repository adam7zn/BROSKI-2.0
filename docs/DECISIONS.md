# Architecture Decision Log

## How to use this document

Record decisions that would otherwise be repeatedly debated or that constrain multiple workstreams. Small implementation choices belong in code and PR descriptions; consequential choices belong here or in a dedicated `docs/adr/NNN-title.md` file.

## Decision status

- `PROPOSED`
- `ACCEPTED`
- `SUPERSEDED`
- `REJECTED`

---

## ADR-001 — One student, one course, one textbook

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Decision

The first MVP supports William only, his current mathematics course, one exact textbook, and one Canvas course.

### Reason

The primary uncertainty is whether the timeline-driven proactive learning loop is useful, not whether the system can support many tenants or subjects.

### Consequences

- no multi-school administration;
- no generic curriculum marketplace;
- database still uses stable IDs rather than hard-coded global variables;
- content and behavior can be deeply tailored to the real course.

---

## ADR-002 — Timeline-first planning

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Decision

Every proactive planning run starts from the current date, past/current/upcoming lessons, assessment dates, and review queue.

### Reason

The differentiator is not generic tutoring; it is remembering previous weeks and preparing relevant prerequisites before future lessons.

### Consequences

- Canvas/lesson-plan quality is a core dependency;
- planning must distinguish source certainty;
- time-zone and idempotent scheduling tests are mandatory.

---

## ADR-003 — One main study agent with explicit modes

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Decision

Use one learning engine with `REVIEW`, `PRACTISE`, `PREPARE`, `DIAGNOSE`, `TEACH`, `ASSESS`, and `NO_ACTION` modes. Do not begin with multiple autonomous agents.

### Reason

A single structured decision path is easier to test, trace, and improve for an MVP.

### Consequences

- modes may use separate prompts/functions;
- future service separation remains possible;
- no agent-to-agent orchestration layer is required.

---

## ADR-004 — PostgreSQL plus pgvector

**Status:** PROPOSED  
**Date:** 2026-08-28

### Decision

Use PostgreSQL for domain state and `pgvector` for textbook retrieval in the same database, preferably through Supabase for MVP speed.

### Reason

The data is relational and modest in scale. One operational database reduces complexity while preserving vector search.

### Consequences

- embeddings and relational source provenance can be joined directly;
- no separate vector database initially;
- revisit only if retrieval scale or capability requires it.

---

## ADR-005 — Raw evidence before derived mastery

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Decision

Preserve every raw attempt and evaluation. Mastery, misconception status, and review priority are derived and recomputable.

### Reason

The first mastery model will change. Raw evidence prevents irreversible information loss and allows retrospective evaluation.

### Consequences

- more explicit data model;
- rebuild command required;
- derived-state updates occur only after attempt persistence.

---

## ADR-006 — Provider-neutral messaging

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Decision

Expose a `MessagingProvider` interface and keep iMessage-specific details in one adapter.

### Reason

The private pilot may use a Mac bridge or hosted provider, but messaging infrastructure should not determine the learning architecture.

### Consequences

- fake provider enables early end-to-end tests;
- provider selection can happen after a spike;
- normalized events and idempotency are required.

---

## ADR-007 — TypeScript-first monorepo

**Status:** PROPOSED  
**Date:** 2026-08-28

### Decision

Use a TypeScript-first monorepo for API, worker, contracts, learning logic, and adapters. Add Python only for a specific extraction or symbolic-math need.

### Reason

A shared type system simplifies two-person parallel development and contract testing.

### Consequences

- one package manager and CI path;
- optional Python tool must have a narrow documented interface;
- framework choice remains to be recorded separately.

---

## ADR-008 — Shadow mode before autonomous messaging

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Decision

Proactive decisions run in shadow mode and then approval mode before autonomous delivery.

### Reason

A wrong or annoying proactive message is more damaging than a poor answer to a user-initiated request.

### Consequences

- planner must support `dryRun`;
- admin UI must show candidate decisions;
- autonomy is feature-flagged.

---

# ADR template

```markdown
## ADR-NNN — Title

**Status:** PROPOSED  
**Date:** YYYY-MM-DD

### Context

What problem or constraint requires a decision?

### Options considered

1. Option A
2. Option B
3. Option C

### Decision

What are we choosing?

### Reason

Why is this the best choice for the current phase?

### Consequences

Positive and negative consequences, migration needs, and review trigger.

### Revisit when

What evidence or scale would justify reconsidering this decision?
```

## Decisions still required before Phase 1 implementation

1. Exact API framework.
2. Hosting provider and environment strategy.
3. First messaging provider/bridge after a spike.
4. Textbook extraction toolchain.
5. Deterministic symbolic mathematics strategy for the current chapter.
6. Model provider and data-retention settings.
7. Initial quiet hours and proactive-message cap.

