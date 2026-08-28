# Project Rules

These rules protect the learning quality, reliability, privacy, and parallel development of the MVP. A rule may be changed through an explicit decision record, not silently bypassed.

## 1. Product rules

1. The MVP serves one student, one mathematics course, and one textbook.
2. The timeline controls the experience: every proactive item must relate to past, current, or upcoming course work.
3. The system must be able to choose `NO_ACTION`.
4. Prefer the smallest useful interaction over a long generic session.
5. Do not add multi-user, multi-school, or multi-subject scope before the personal pilot is evaluated.
6. A feature is not complete without a real user-visible acceptance scenario.

## 2. Learning rules

1. Use retrieval before explanation when the student has enough prior exposure to attempt an answer.
2. Separate review, current practice, and future preparation; do not disguise one as another.
3. Review timing depends on both elapsed time and performance evidence.
4. One incorrect answer is evidence, not proof of a stable misconception.
5. Target recurring misconceptions with diagnostic questions rather than random repetition.
6. Evaluate reasoning when it is available, not only the final answer.
7. Do not claim a mastery percentage that cannot be explained from stored evidence.
8. Lower confidence or request clarification when the answer is ambiguous.
9. Keep questions aligned with the methods and notation used in the current course and textbook.
10. Visuals are used only when they materially improve comprehension.

## 3. AI rules

1. Model output is untrusted until it passes a runtime schema.
2. Prefer deterministic mathematics checks where they are reliable.
3. Store model, prompt, schema, and evaluator versions for every consequential run.
4. Keep retrieved source passages and student context limited to what the task requires.
5. Never invent a textbook page, course event, student attempt, or source citation.
6. Distinguish source facts, derived estimates, and model hypotheses in stored data.
7. Do not update learning state when evaluation confidence is below the agreed threshold.
8. Generated questions must have an expected answer or explicit rubric before delivery.
9. Feedback should be concise, specific, and proportionate to the student's error.
10. Prompt changes require regression fixtures for important behavior.

## 4. Messaging rules

1. Use a provider-neutral messaging contract.
2. Do not send proactively until shadow and approval-mode gates pass.
3. Enforce quiet hours, cooldowns, and daily caps outside the model.
4. Each outbound interaction has one stable idempotency key.
5. Each inbound provider event is processed at most once.
6. A reply must be correlated to a study item before it changes learning state.
7. If correlation is uncertain, store the message and ask for clarification rather than guessing.
8. Silence, pauses, and opt-out requests are respected immediately.
9. Do not send sensitive course or performance details to group conversations.
10. Message tone may feel friendly, but it must never use shame, pressure, or fabricated urgency.

## 5. Data rules

1. PostgreSQL is the source of truth for structured MVP state.
2. Preserve raw events and attempts before calculating derived state.
3. Derived mastery and review state must be reproducible from evidence and versioned logic.
4. Every content item retains source provenance.
5. Failed source imports do not replace the last known-good course snapshot.
6. Dates are stored consistently; user-facing scheduling uses the configured Europe/Stockholm time zone.
7. Credentials never appear in repository files, prompts, fixtures, or logs.
8. Test fixtures use synthetic or deliberately minimized personal data.
9. Export and deletion must cover course, message, attempt, and derived learning data.
10. Retention follows [Security and privacy](SECURITY_PRIVACY.md).

## 6. Engineering rules

1. Shared contracts use runtime validation and live in the shared contracts package.
2. Workstreams depend on contracts, not another workstream's internal modules.
3. Every external boundary has an adapter and a fixture or fake implementation.
4. Database changes use reviewed, forward migrations.
5. Scheduled jobs, webhooks, and outbound sends are idempotent.
6. Retries are bounded and distinguish transient from permanent failures.
7. Every end-to-end interaction has a trace ID.
8. Tests cover success, uncertainty, duplicate, timeout, and failure paths.
9. A clean checkout must be able to run formatting, types, migrations, and tests with documented commands.
10. Do not merge knowingly broken main-branch behavior.

## 7. Collaboration rules

1. Every file or code area has one primary owner as defined in [Team ownership](TEAM_OWNERSHIP.md).
2. The owner implements; the other person reviews changes that affect shared contracts, user-visible behavior, security, or operations.
3. Contract changes are proposed before dependent implementation diverges.
4. Keep pull requests small enough to review and demonstrate one coherent outcome.
5. Link consequential technical decisions to [Decision log](DECISIONS.md).
6. Raise blockers early with the blocked contract, required decision, and proposed fallback.
7. Do not edit another owner's high-conflict file without coordination.
8. Use fixtures so unfinished live integrations do not block other workstreams.
9. Update relevant documentation in the same pull request as behavior changes.
10. A completed issue includes tests, observability, and acceptance evidence—not only implementation.

## 8. Source and content rules

1. Use the textbook only with the necessary permission for the pilot.
2. Store and transmit only the source material necessary for the feature.
3. Do not expose full textbook content through public endpoints or logs.
4. Direct textbook questions retain page/exercise provenance.
5. Adapted questions must be mathematically verified and distinguishable from verbatim source exercises.
6. Automated concept mappings below the confidence threshold require review before live use.

## 9. Pilot rules

1. Shadow mode comes before approval mode; approval mode comes before limited live mode.
2. Every poor or mistimed recommendation is logged, not rationalized away.
3. Measure learning evidence and interruption cost, not just message counts.
4. Weekly review can reduce frequency, narrow scope, or pause automation.
5. A serious privacy, source-accuracy, or duplicate-send failure pauses live automation until understood.
6. Pilot continuation follows the criteria in [Evaluation](EVALUATION.md).

