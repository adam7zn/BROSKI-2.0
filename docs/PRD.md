# Product Requirements Document

## 1. Product summary

The Math Study Companion is a proactive, personal learning agent for William's current mathematics course. It uses the course timeline, the exact textbook, and William's learning history to choose small, timely study interactions.

It is not a general homework chatbot. Its defining behavior is that it reasons backward and forward from the current date:

> What from previous weeks should William retrieve now, what should he practise from the current lesson, and what prerequisite should he encounter before the next lesson?

## 2. Problem

Students usually have access to lessons, textbooks, calendars, and generic AI tutors, but those systems do not maintain one coherent view of:

- where the class is in the course;
- how textbook concepts relate to dated lessons;
- what the individual student has previously attempted;
- which knowledge is likely to be forgotten;
- which future topic would benefit from preparation;
- when a short interruption is worth making.

The student must therefore decide when to study, find the right material, explain the course context, and remember previous weaknesses. That coordination cost makes even good learning techniques easy to skip.

## 3. Target user and pilot

The MVP has one user: William, studying one mathematics course with one primary textbook and one teacher-controlled course plan.

This narrow pilot is intentional. The goal is to establish whether a timeline-aware companion improves preparation, retrieval, and retention before building multi-user or multi-subject infrastructure.

## 4. Product principles

1. **Timeline first.** Every planning decision begins with past, current, and upcoming lessons.
2. **Evidence over confidence.** Student state is derived from attempts, not invented by the model.
3. **Smallest useful interaction.** One 20-second question can be better than a forced session.
4. **Retrieval before explanation.** When appropriate, ask the student to recall or solve before teaching.
5. **Exact-course alignment.** Questions and explanations should use the language and methods of the current textbook.
6. **Proactive but respectful.** Silence is a valid decision; relevance must outweigh interruption cost.
7. **Traceable decisions.** Important claims identify their course, textbook, or attempt evidence.

## 5. Core experience

### Before a lesson — Prepare

Shortly before a lesson, the companion may retrieve a prerequisite or introduce the smallest useful bridge to the upcoming concept.

Example:

> Math in 30 minutes. Tomorrow's factor theorem work uses this idea: if `P(3) = 0`, which factor must `P(x)` contain?

### After a lesson — Check

After class, the companion tests whether the central idea stuck. It evaluates the reasoning, not only the final answer.

### Between lessons — Remember

The companion schedules short retrieval questions from earlier weeks. Correct, confident answers lengthen the interval; errors or fragile reasoning shorten it.

### Before an assessment — Close gaps

The companion compares assessment coverage with available learning evidence, prioritizes weak or stale concepts, and proposes a focused plan.

## 6. Study modes

Every planned interaction has exactly one primary mode:

| Mode | Purpose |
|---|---|
| `REVIEW` | Retrieve a previously taught concept that is due |
| `PRACTISE` | Strengthen current course material |
| `PREPARE` | Prime a prerequisite or upcoming idea |
| `DIAGNOSE` | Distinguish between likely misconceptions |
| `TEACH` | Explain after a gap has been identified |
| `ASSESS` | Collect broader evidence for assessment readiness |
| `NO_ACTION` | Avoid sending a low-value or poorly timed message |

## 7. Functional requirements

### 7.1 Course timeline

The system must:

- store dated lessons and assessments;
- distinguish past, current, and upcoming material;
- map lessons to stable concept identifiers;
- attach source provenance and confidence to imported information;
- tolerate an initially manual course-plan import;
- expose the current course snapshot to the learning engine.

### 7.2 Textbook knowledge

The system must:

- represent chapters, sections, pages, examples, and exercises;
- map textbook material to concepts and prerequisites;
- retain source-page references for retrieved content;
- support manual correction when parsing or mapping is uncertain;
- avoid sending copyrighted source content beyond the permitted pilot use.

### 7.3 Learning memory

The system must:

- store the question, answer, evaluation, timestamps, and concept evidence for every attempt;
- keep raw attempts separate from derived mastery estimates;
- record misconception evidence without treating a single model inference as fact;
- maintain a review queue with an explainable next-review date;
- recalculate derived state when evaluation logic changes.

### 7.4 Planning

Given the current time, course snapshot, relevant textbook content, recent messages, review queue, and student state, the system must return a structured plan containing:

- mode and reason;
- target concept IDs;
- question or activity;
- expected-answer or evaluation rubric;
- source references;
- delivery timing;
- a stable idempotency key;
- the option to return `NO_ACTION`.

### 7.5 Answer evaluation

The system must:

- normalize deterministic answers when feasible;
- evaluate mathematical method as well as final result;
- separate correctness, confidence, and evidence quality;
- produce concise feedback aligned with the detected gap;
- avoid updating mastery when the answer is ambiguous or the evaluator is uncertain;
- preserve the full evaluation trace for later review.

### 7.6 Messaging

The system must:

- use a provider-neutral adapter;
- send text and, later, optional image attachments;
- normalize inbound replies;
- correlate a reply to the active study item;
- prevent duplicate sends;
- respect quiet hours and rate limits;
- support shadow and approval modes before autonomous sending.

### 7.7 Visual explanations

Visuals are used when they materially clarify the concept, including graphs, geometric relationships, transformations, or learning timelines. They are not generated merely to make a message look richer. Every visual must have a textual explanation and be traceable to the study item that requested it.

## 8. Non-functional requirements

- **Privacy:** credentials, school data, messages, and learning records follow [Security and privacy](SECURITY_PRIVACY.md).
- **Reliability:** scheduled jobs and webhooks are idempotent and retryable.
- **Observability:** every plan, send, reply, evaluation, and state update has a traceable run record.
- **Latency:** a normal inbound reply should receive feedback quickly enough to preserve conversational flow.
- **Testability:** core decisions operate on fixtures without live Canvas, messaging, or model access.
- **Portability:** messaging and model providers remain behind adapters.

## 9. Out of scope for the first pilot

- multiple students or schools;
- every school platform or textbook;
- non-mathematics subjects;
- authoritative grading or exam proctoring;
- a parent or teacher analytics product;
- unrestricted autonomous messaging from day one;
- a large multi-agent architecture;
- a polished consumer dashboard before the learning loop works.

## 10. MVP success criteria

The pilot succeeds when:

- the course timeline and textbook mappings are accurate enough to trust;
- the complete question-to-feedback loop works reliably;
- recommendations are usually judged relevant to the current date and course;
- old concepts are retrieved at useful intervals;
- preparation questions make upcoming lessons easier;
- recurring misconceptions can be detected and targeted;
- message burden remains acceptable;
- manual work and failure modes are understood well enough to choose the next investment.

Detailed thresholds and pilot stages are defined in [Evaluation](EVALUATION.md).

## 11. Acceptance scenario

On a real school day, the system can:

1. identify William's next mathematics lesson;
2. retrieve its concepts and textbook references;
3. select one relevant prerequisite or review item using learning history;
4. deliver a concise question at an allowed time;
5. receive and correlate William's reply;
6. evaluate both result and reasoning;
7. store raw evidence and update derived review state;
8. send concise, helpful feedback;
9. explain afterward why the question was chosen.


