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

## ADR-009 — Telegram as the first messaging provider

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Context

The companion's defining behaviour is proactive: a question before a lesson, a
retrieval prompt days after one. The provider must therefore allow a
free-form message the student did not ask for.

### Options considered

1. WhatsApp Cloud API
2. Telegram Bot API
3. An iMessage bridge on a Mac

### Decision

Telegram Bot API, behind the `MessagingProvider` interface of ADR-006.

### Reason

WhatsApp only allows free-form business messages inside a 24-hour window opened
by the student. Every proactive nudge outside it needs a pre-approved Meta
template, which makes the product's central behaviour a template-approval
problem. It also requires business verification, a dedicated number, and a
public HTTPS webhook.

Telegram has no such window, needs no verification, and supports long polling —
so real messages work from a laptop before anything is deployed.

### Consequences

- proactive sending is a product decision, not a provider negotiation;
- long polling now, webhook later, with `normalizeTelegramUpdate` as the shared
  inbound contract;
- WhatsApp or iMessage remain possible as additional adapters;
- the bot must ignore group chats and any chat id other than the pilot's.

### Revisit when

The student would rather use another app, or the pilot needs more than one
recipient.

---

## ADR-010 — Claude for question generation and evaluation

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Decision

Use the Anthropic Messages API (`claude-opus-5` by default, overridable with
`MSC_MODEL`) through one adapter, with structured outputs validated by a runtime
schema, and a deterministic scripted agent as the offline fallback.

### Reason

Judging a student's *method* is the part of the loop a rule engine cannot do.
Structured outputs keep model responses inside a schema, which is what
`docs/RULES.md` §3.1 requires, and the answer check in front of it means simple
arithmetic never depends on the model being right.

### Consequences

- an API key is the only credential the agent needs, read from the environment;
- prompt and model versions are recorded with every run;
- the whole loop still runs, and is tested, with no key present;
- cost per interaction is two short calls.

### Revisit when

Evaluation quality is measured against the golden cases, or cost per interaction
matters more than judgement quality.

---

## ADR-011 — SQLite for the pilot, PostgreSQL when it leaves the laptop

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Decision

Store interactions, attempts, and the send ledger in a local SQLite file
(`node:sqlite`, no dependency). Keep the column shapes aligned with
`docs/DATA_MODEL.md` so the move to PostgreSQL (ADR-004) is a migration.

### Reason

One student on one laptop does not need a database server, and needing one is
enough friction to stop the pilot from running at all. Nothing in the schema
depends on SQLite.

### Consequences

- the pilot runs with `npm install` and nothing else;
- no `pgvector`, so semantic retrieval waits for the PostgreSQL move;
- the database file holds real answers from a real student and is git-ignored;
- ADR-004 stands for the hosted deployment.

### Revisit when

The companion runs somewhere other than a personal machine, or textbook
retrieval needs embeddings.

---

## ADR-012 — Timeline rules before a learning model

**Status:** ACCEPTED  
**Date:** 2026-08-28

### Context

ADR-002 requires planning to start from the date. Something has to decide which
item that produces, and the tempting answer is a model — either a learned
mastery estimate or asking Claude to choose.

### Decision

Decide with explicit rules over the calendar and the attempt record: prepare
before a lesson, practise after one, otherwise review what is due, and stay
quiet when nothing is. Review intervals double on a correct answer, collapse on
a wrong one, and ignore an unreadable one. The model writes and judges the
question; it does not choose it.

### Reason

Every decision has to be explainable in one sentence before proactive sending
is allowed at all (`docs/PHASES.md` Phase 5), and a rule can be read straight
off the record while a mastery estimate cannot. It also costs nothing to run,
so `npm run plan` can show a whole week ahead.

### Consequences

- the reason string is part of the contract, not a debug line;
- `NO_ACTION` is reachable, and reached, without a model call;
- no mastery percentage is claimed anywhere;
- richer scheduling stays possible: the raw attempts are all preserved (ADR-005),
  so any later model can be backfilled from them.

### Revisit when

The pilot shows the intervals are wrong for him, or the item chosen within a
mode is regularly the wrong one.

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

## Decisions still open

Settled since: the messaging provider (ADR-009), the model provider (ADR-010),
and pilot storage (ADR-011). No HTTP framework is needed yet — the runners are
CLI processes, and the API server arrives with deployment.

1. Hosting provider and environment strategy, once sending leaves the laptop.
2. Textbook extraction toolchain.
3. Deterministic symbolic mathematics beyond the current answer checker.
4. Model data-retention settings.
5. Initial quiet hours and proactive-message cap — required before anything is
   sent on a schedule.

