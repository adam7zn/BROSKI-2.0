# Initial Backlog for a Two-Person Team

> **Deferred backlog:** Do not begin these milestones until the corresponding work is admitted by [Delivery phases](PHASES.md). The current starting tasks and current ownership split live in that document.

This backlog is written so tasks can be copied into GitHub Issues or another tracker. Person A owns course and learning intelligence; Person B owns platform and delivery. IDs are temporary.

## Milestone M0 — Repository and contracts

### Shared

- **M0-01:** Confirm workstream boundaries and code-owner rules.
- **M0-02:** Add formatting, linting, type checking, tests, and CI.
- **M0-03:** Implement shared ID, date, source-reference, and error contracts.
- **M0-04:** Add environment templates and secret-handling documentation.
- **M0-05:** Add the ADR process and PR template.
- **M0-06:** Agree on synthetic and sanitized fixture conventions.

### Person A — Course and learning intelligence

- **M0-A1:** Create course, textbook, student, and learning fixtures.
- **M0-A2:** Define `CourseSnapshot`, `Lesson`, `Assessment`, `Concept`, and `Exercise` schemas.
- **M0-A3:** Define `PlanningRequest`, `PlannedInteraction`, `StudyItem`, and `EvaluationResult` schemas.
- **M0-A4:** Provide sample source-provenance objects.
- **M0-A5:** Create golden cases for review, prepare, practise, diagnose, and no-action decisions.

### Person B — Platform and delivery

- **M0-B1:** Initialize the monorepo and package boundaries.
- **M0-B2:** Create the database migration workflow and repository interfaces.
- **M0-B3:** Implement a fake messaging provider.
- **M0-B4:** Implement minimal API and worker shells with trace IDs.
- **M0-B5:** Build the first end-to-end fake-message test.
- **M0-B6:** Provide in-memory adapters for Person A's tests.

## Milestone M1 — Textbook knowledge

### Person A — Course and learning intelligence

- **M1-A1:** Store the original textbook privately with checksum and version metadata.
- **M1-A2:** Extract pages while preserving printed and file page numbers.
- **M1-A3:** Detect chapters and sections.
- **M1-A4:** Draft the concept taxonomy for the current chapter.
- **M1-A5:** Extract and verify 20 current-course exercises.
- **M1-A6:** Link concepts to pages, chunks, examples, and exercises.
- **M1-A7:** Implement exercise query and ranking logic.
- **M1-A8:** Define expected-answer payload variants.
- **M1-A9:** Implement answer normalization for the current chapter.
- **M1-A10:** Create validation tests for adapted questions.
- **M1-A11:** Specify the retrieval-quality review workflow.

### Person B — Platform and delivery

- **M1-B1:** Implement the document, page, chunk, concept, and exercise schema.
- **M1-B2:** Add pgvector and the embedding-job interface.
- **M1-B3:** Add the object-storage wrapper.
- **M1-B4:** Add import-run status and error inspection.
- **M1-B5:** Build the retrieval-quality review screen from Person A's workflow.

## Milestone M2 — Course timeline

### Person A — Course and learning intelligence

- **M2-A1:** Spike Canvas access and document available course fields.
- **M2-A2:** Define and implement the normalized Canvas source adapter.
- **M2-A3:** Define lesson, assignment, and assessment normalization rules.
- **M2-A4:** Implement lesson-to-concept mapping.
- **M2-A5:** Define the manual mapping-override behavior.
- **M2-A6:** Verify past, current, and next two weeks of course data.
- **M2-A7:** Implement candidate concepts from recent, current, and upcoming lessons.
- **M2-A8:** Implement prerequisite lookup for upcoming lessons.
- **M2-A9:** Implement the first transparent candidate-priority formula.

### Person B — Platform and delivery

- **M2-B1:** Implement Canvas credential storage and the synchronization job.
- **M2-B2:** Persist normalized lessons, assignments, and assessments with source IDs.
- **M2-B3:** Add synchronization diffs and source-freshness tracking.
- **M2-B4:** Build the timeline and manual-override admin views.
- **M2-B5:** Add idempotent synchronization tests.

## Milestone M3 — Learning loop

### Person A — Course and learning intelligence

- **M3-A1:** Implement planner modes and structured reasons.
- **M3-A2:** Implement direct textbook item creation.
- **M3-A3:** Implement parameterized item creation for verified templates.
- **M3-A4:** Implement the evaluator for the current chapter.
- **M3-A5:** Implement feedback generation.
- **M3-A6:** Implement misconception-evidence thresholds.
- **M3-A7:** Implement review-interval update logic.
- **M3-A8:** Implement derived concept-state recalculation.
- **M3-A9:** Supply verified explanation chunks and misconception contrasts.
- **M3-A10:** Verify every content item used in the demo.

### Person B — Platform and delivery

- **M3-B1:** Implement interactions and active-item state.
- **M3-B2:** Implement attempts and transaction-safe evaluation persistence.
- **M3-B3:** Implement inbound-event deduplication.
- **M3-B4:** Implement the agent-run trace view.
- **M3-B5:** Add manual plan, send, and evaluate controls.
- **M3-B6:** Connect the learning engine through the published interface.

## Milestone M4 — Real messaging

### Person A — Course and learning intelligence

- **M4-A1:** Optimize message format for one-question interactions.
- **M4-A2:** Define behavior for ambiguous replies and hint requests.
- **M4-A3:** Add conversation-state fixtures and tests.
- **M4-A4:** Verify that source references remain internally inspectable without cluttering casual messages.

### Person B — Platform and delivery

- **M4-B1:** Run the provider or bridge spike.
- **M4-B2:** Record the provider decision in an ADR.
- **M4-B3:** Implement the real adapter behind a feature flag.
- **M4-B4:** Implement image sending.
- **M4-B5:** Implement delivery status and bounded retry.
- **M4-B6:** Implement pause, resume, and stop handling.
- **M4-B7:** Implement quiet hours.

## Milestone M5 — Proactive engine

### Person A — Course and learning intelligence

- **M5-A1:** Implement the no-action policy.
- **M5-A2:** Implement ranking across review, current, and prepare candidates.
- **M5-A3:** Add repeated-concept and burden constraints.
- **M5-A4:** Add the assessment-priority policy.
- **M5-A5:** Create 50 planner regression fixtures.
- **M5-A6:** Verify future-lesson prerequisites.
- **M5-A7:** Review shadow decisions for source, timeline, and pedagogical accuracy.

### Person B — Platform and delivery

- **M5-B1:** Implement before-lesson candidate jobs.
- **M5-B2:** Implement after-lesson candidate jobs.
- **M5-B3:** Implement the review scan.
- **M5-B4:** Implement the assessment scan.
- **M5-B5:** Implement the daily cap and scheduler idempotency.
- **M5-B6:** Implement shadow, approval, and live feature flags.

## Milestone M6 — Visuals

### Person A — Course and learning intelligence

- **M6-A1:** Define the visual-selection policy.
- **M6-A2:** Specify correctness rules and source alignment for each visual type.
- **M6-A3:** Add visual correctness fixtures.
- **M6-A4:** Review pilot visuals for pedagogical usefulness.

### Person B — Platform and delivery

- **M6-B1:** Implement the verified function-plot renderer.
- **M6-B2:** Implement the algebra-step card renderer.
- **M6-B3:** Store visual provenance and renderer version.
- **M6-B4:** Deliver images through the messaging adapter.

## Milestone M7 — Pilot

### Shared

- **M7-01:** Complete 10 shadow decisions; Person A reviews learning quality and Person B reviews traces and delivery behavior.
- **M7-02:** Run approval mode for at least five interactions.
- **M7-03:** Enable one proactive message per day.
- **M7-04:** Record a weekly qualitative review.
- **M7-05:** Recalculate concept states and inspect drift.
- **M7-06:** Review every incorrect grading event.
- **M7-07:** Write the pilot report together.
- **M7-08:** Decide whether to continue, revise, or stop.

## Sequencing rule

For work that crosses the two workstreams:

1. agree on the contract and acceptance example;
2. Person A implements domain behavior against a fixture;
3. Person B implements persistence or delivery against a fake domain response;
4. integrate only after both isolated tests pass;
5. verify the complete user-visible flow together.

## Issue template

```markdown
## Goal

## Owner

## Reviewer

## User/system behavior

## Scope

## Out of scope

## Contract/schema impact

## Acceptance criteria

- [ ]

## Test plan

## Observability

## Security/privacy considerations

## Dependencies
```

