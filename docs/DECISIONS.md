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

**Status:** SUPERSEDED BY ADR-012
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

## ADR-012 — Hosted Sendblue transport with an in-process agent port

**Status:** ACCEPTED
**Date:** 2026-08-29

### Decision

Run the Phase 3 real-message path as one Render Node web service containing the API, authenticated
Sendblue webhook, and durable PostgreSQL inbox/outbox worker. Sendblue is the only live transport.
The existing Telegram agent behavior migrates behind the in-process `ConversationAgent` interface;
it must return validated intents and must not call either Telegram or Sendblue directly.

### Reason

The pilot must work without an awake Mac while preserving one coherent learning engine and
at-most-once outbound behavior. Keeping transport ownership in the messaging worker allows the
partner to reuse agent behavior without carrying Telegram-specific delivery, webhook, or secret
handling into the hosted path.

### Consequences

- webhook requests use a separate secret; hosted internal routes use bearer authentication;
- Sendblue account-level events are filtered to the configured participant and line;
- session, minimized inbox, and outbox state are durably claimed and restart-safe;
- stable idempotency keys are reserved before provider calls, and ambiguous sends are never retried;
- SMS downgrade fails the session closed, while `MESSAGING_LIVE_ENABLED=false` is the default;
- attachments require HTTPS media URLs, and the first live test remains text-only;
- the deterministic agent remains the fake integration fixture until the partner ports the current
  Telegram/Anthropic behavior and supplies `ANTHROPIC_API_KEY` through Render secrets;
- automated tests use injected fake providers and never contact Sendblue or hosted PostgreSQL.

### Revisit when

The pilot needs multiple recipients, horizontal worker concurrency beyond one Render instance,
provider failover, a supported Sendblue idempotency API, or a separately deployed agent process.
