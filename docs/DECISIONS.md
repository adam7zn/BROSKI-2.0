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

**Status:** ACCEPTED
**Date:** 2026-08-28

### Decision

Use Supabase-hosted PostgreSQL for runtime domain state and keep `pgvector` available for later
textbook retrieval in the same database. Use disposable local PostgreSQL for development and CI
integration tests.

### Reason

The data is relational and modest in scale. One operational database reduces complexity while preserving vector search.

### Consequences

- embeddings and relational source provenance can be joined directly;
- no separate vector database initially;
- the API connects through a standard PostgreSQL repository and does not depend on the Supabase Data API;
- runtime credentials stay in deployment secrets or ignored local environment files;
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

## ADR-009 — Minimal TypeScript workspace toolchain

**Status:** ACCEPTED
**Date:** 2026-08-28

### Decision

Use pnpm workspaces with Node.js 22, TypeScript, ESLint, Prettier, and Vitest. CI runs one locked install followed by formatting, linting, type checking, and tests.

### Reason

This provides one small, reproducible toolchain for both workstreams without choosing an API framework or adding future-phase infrastructure.

### Consequences

- `pnpm-lock.yaml` is committed and CI uses `pnpm install --frozen-lockfile`;
- workspace packages share root quality configuration;
- API framework, database tooling, and deployment remain unresolved.

---

## ADR-010 — Fully local structured textbook extraction

**Status:** ACCEPTED
**Date:** 2026-08-29

### Decision

Chapter 1 extraction runs entirely on William's Mac. Apple Vision performs two
document-recognition passes, and CPU-only pix2tex is restricted to suspected
formula crops. PostgreSQL stores ordered blocks, immutable engine candidates,
and append-only human reviews. No page or extracted block is sent to an API or
hosted OCR service.

### Reason

The textbook is private, mathematics needs region-level evidence, and OCR
confidence alone cannot establish correctness. A local, review-gated pipeline
keeps the source on-device while preserving enough provenance to correct it.

### Consequences

- extraction requires macOS 26 Apple Vision and an isolated Python 3.11 pix2tex environment;
- every meaningful block remains pending until explicit human review;
- `source_pages.extracted_text` is rebuilt only from approved blocks;
- the review API and admin app bind to localhost and require `ADMIN_TOKEN`;
- source images and extraction JSON remain Git-visible by William's explicit request;
- model caches and virtual environments remain machine-local dependencies.

### Revisit when

Apple Vision or pix2tex cannot reach acceptable accuracy on the chapter's
golden pages, or the source is licensed for a different processing model.

---

## ADR-011 — Local iMessage CLI for the single-device judge demo

**Status:** ACCEPTED
**Date:** 2026-08-29

### Decision

Use Beeper's open-source `platform-imessage` release (`imessage-cli`) behind the
provider-neutral messaging interface for the first real-message demonstration.
The Mac uses a dedicated companion Apple identity and polls the configured
one-to-one chat for one inbound reply. System Integrity Protection stays
enabled, and Apple credentials remain in Messages.app and macOS Keychain.

### Reason

The judge MVP needs a real blue-bubble phone experience without adding a paid
relay, public webhook, or provider account. The CLI supports the normal macOS
security model and exposes structured send/read operations that can be isolated
inside one adapter.

### Consequences

- the demo Mac must stay awake with Messages.app signed in;
- macOS Messages Data, Accessibility, Contacts, and Automation permissions are required;
- PostgreSQL reserves outbound idempotency keys before the CLI is called and stores normalized metadata without message bodies;
- automated tests use the fake provider and never send a live message;
- Canvas, scheduling, model-backed evaluation, and arbitrary tutoring remain out of scope.

### Revisit when

The pilot must run without an awake Mac, support more than one account, or meet
delivery guarantees that the local CLI cannot provide.

---

## ADR-012 — Telegram alongside iMessage

**Status:** ACCEPTED  
**Date:** 2026-08-29

### Context

ADR-011 chose the local iMessage CLI for the judge demo: real blue bubbles, no
account, no public webhook. It costs a Mac that stays awake with Messages.app
signed in, which is exactly what a scheduled morning nudge cannot rely on.

### Decision

Keep both adapters behind the `MessagingProvider` interface of ADR-006.
iMessage stays the demo path. Telegram is the everyday path: a BotFather token,
long polling, no Mac, no verification, and no restriction on unprompted
messages.

### Reason

WhatsApp was the obvious third option and is the wrong one here — free-form
business messages are only allowed inside a 24-hour window the student opens,
so every proactive nudge would need a pre-approved Meta template. Telegram has
no such window. Running both costs one adapter file, and the choice of provider
stops being coupled to whether the demo machine is awake.

### Consequences

- `MediaSource` distinguishes a local file from a URL, because iMessage sends
  the first and Telegram fetches the second;
- an adapter handed media it cannot deliver raises rather than sending nothing;
- automated tests use the fake provider and never send a live message;
- a third provider is one file, not a redesign.

### Revisit when

The pilot settles on one channel for good, or a provider stops meeting delivery
needs.

## ADR-013 — Claude for question generation and evaluation

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

## ADR-014 — A local SQLite store only until the planner speaks to the API

**Status:** ACCEPTED  
**Date:** 2026-08-29

### Context

The planner needs somewhere to read attempt history from. PostgreSQL behind the
API (ADR-004) is that place, but the planner was built before the two halves
met, against a local SQLite file.

### Decision

Keep the SQLite store inside `apps/companion` as the runner's own local
persistence, not as a package anything else depends on. PostgreSQL through the
API stays the system of record. The planner's inputs are plain values, so
swapping the source is a change in one file.

### Reason

Deleting it now would leave `pnpm chat` unable to run at all without a database
server, and the offline path is what makes the loop testable on any machine.
Keeping it as a shared package would instead invite a second source of truth.

### Consequences

- two stores exist during the transition, and only one is authoritative;
- the local file is git-ignored: it holds real answers from a real student;
- `apps/companion/src/api-client.ts` is where the planner's history will come
  from once it reads the API, and this ADR is closed when it does.

### Revisit when

The planner reads attempt history through the API. That retires this decision.

## ADR-015 — Timeline rules before a learning model

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

## ADR-016 — Hosted Sendblue transport with an in-process agent port

**Status:** ACCEPTED
**Date:** 2026-08-29

### Decision

Run the Phase 3 real-message path as one Render Node web service containing the API, authenticated
Sendblue webhook, and durable PostgreSQL inbox/outbox worker. Sendblue is the only hosted live
transport. Local iMessage and Telegram adapters remain available for their existing local runners.
Hosted conversation behavior is exposed through an in-process `ConversationAgent` interface that
returns validated intents and never calls a messaging provider or PostgreSQL directly.

### Reason

The pilot must work without an awake Mac while preserving one coherent learning boundary and
at-most-once outbound behavior. Keeping transport ownership in the messaging worker prevents
provider calls, delivery uncertainty, and persistence from leaking into agent code.

### Consequences

- webhook requests use a separate secret; hosted internal routes use bearer authentication;
- Sendblue account-level events are filtered to the configured participant and line;
- session, minimized inbox, and outbox state are durably claimed and restart-safe;
- stable idempotency keys are reserved before provider calls, and ambiguous sends are never retried;
- SMS downgrade fails the session closed, while `MESSAGING_LIVE_ENABLED=false` is the default;
- an authenticated status route exposes the kill-switch state and can perform a no-send iMessage
  availability lookup before the operator enables delivery;
- attachments require HTTPS media URLs, and the first live test remains text-only;
- the deterministic agent proves the canonical infrastructure loop; adapting the richer `StudyAgent`
  to this boundary is a later behavior change and does not move its transport responsibilities;
- automated tests use injected fake providers and never contact Sendblue or hosted PostgreSQL;
- a read-only migration-ledger audit preserves historical filenames. A legacy applied
  `0002_add_completed_at.sql` entry may coexist with the current idempotent
  `0003_add_completed_at.sql` forward entry; neither applied record is rewritten.

### Revisit when

The pilot needs multiple recipients, horizontal worker concurrency beyond one Render instance,
provider failover, a supported Sendblue idempotency API, or a separately deployed agent process.

---

## ADR-017 — Human-verified exercise catalog with explicit Claude activation

**Status:** ACCEPTED
**Date:** 2026-08-30

### Context

The fixed Phase 3 equation proves delivery and durability but is not sufficient evidence that the
companion uses the real textbook. Raw OCR is private and mathematically unverified, while allowing a
model to choose or rewrite source material would blur provenance and correctness.

### Decision

Store a small catalog of private textbook exercises as drafts linked to page/block provenance.
Human approve/correct/reject reviews are append-only, and only verified rows can be selected through
an authenticated manual route. Store the selected exercise ID on the interaction and deliver its
approved prompt unchanged.

Adapt `ClaudeStudyAgent` behind the deployed `ConversationAgent` only for reply interpretation,
bounded hints, and concise feedback. Keep onboarding deterministic. Hosted agent selection is
explicit through `CONVERSATION_AGENT_PROVIDER`; choosing `anthropic` requires a key and never falls
back silently. Use `claude-sonnet-5` as the new default model override. This supersedes ADR-013's
default model and fallback wording for the hosted conversation path; local standalone runners may
retain their explicit offline mode.

### Reason

The catalog makes every question traceable to an inspected source and expected answer. Manual
selection proves the useful real-material loop before Canvas planning is allowed to choose an item.
The explicit provider gate keeps infrastructure tests deterministic and prevents a missing or failed
model from silently changing learning behavior.

### Consequences

- page images, verbatim manifests, and real answers remain private and outside Git;
- import creates drafts only, and hosted migration/import require separate review and approval;
- the public messaging worker receives a validated verified-exercise context through its existing
  agent boundary and keeps all provider calls outside the agent;
- Claude sees only the selected prompt, answer/rubric, and bounded transcript;
- timeout, rate-limit, or invalid structured output preserves inbound evidence and queues no
  invented feedback;
- Canvas selection, adaptive scheduling, and a broader deterministic algebra checker remain future
  phases.

### Revisit when

The ten-interaction Phase 4 acceptance loop is measured, Canvas is ready to select exercises, or a
model/privacy review requires a different provider or model.

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

---
