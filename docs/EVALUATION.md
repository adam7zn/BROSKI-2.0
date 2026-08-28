# MVP Evaluation Plan

## 1. Purpose

This is an `n=1` personal pilot. It is intended to determine whether the product is useful for William and whether the core learning loop works. It is not sufficient evidence for broad educational claims.

## 2. Questions the pilot must answer

1. Does the system understand the real course timeline accurately enough?
2. Does it select questions that feel relevant to the current date and course position?
3. Does reviewing older material improve later retrieval?
4. Does previewing prerequisites make upcoming lessons easier to follow?
5. Does the agent identify recurring errors usefully?
6. Are the proactive messages helpful enough to justify their interruption cost?
7. Can the entire loop run without manual technical intervention most days?

## 3. Pilot stages

### Stage A — Shadow mode

The system creates candidate decisions but sends nothing automatically.

Review each candidate for:

- correct timing;
- correct lesson/topic;
- correct page/concept mapping;
- appropriate mode;
- suitable question;
- accurate expected answer;
- whether silence would have been better.

Target before live mode: at least 10 consecutive safe decisions.

### Stage B — Approval mode

William sees or approves each candidate before it is sent. Measure how often he rejects or edits it.

### Stage C — Limited live mode

Maximum one proactive initiation per day, excluding an active back-and-forth session.

### Stage D — Normal pilot

Policy-controlled proactive delivery for 2–4 weeks.

## 4. Primary metrics

### 4.1 Source/timeline accuracy

| Metric | Definition |
|---|---|
| Lesson identification accuracy | Correct next lesson/topic divided by reviewed lesson candidates |
| Source reference accuracy | Correct page/section/exercise reference divided by reviewed references |
| Mapping correction rate | Percentage of lesson-concept mappings requiring manual correction |

### 4.2 Interaction quality

| Metric | Definition |
|---|---|
| Relevant initiation rate | Initiations William rates useful or clearly relevant |
| Unnecessary initiation rate | Initiations that should have been silent |
| Response rate | Initiations receiving a meaningful reply |
| Completion rate | Started interactions reaching a natural completion |
| Median interaction length | Messages/questions per completed interaction |
| Time to useful feedback | Time from reply to correct feedback |

### 4.3 Learning evidence

| Metric | Definition |
|---|---|
| Delayed retrieval success | Correctness when a concept reappears after 3+ days |
| Retention improvement | Change in delayed retrieval performance for repeatedly sampled concepts |
| Misconception recurrence | Whether targeted errors continue after remediation |
| Hint dependence | Change in hint use for the same concept/difficulty |
| Transfer success | Performance on a varied problem rather than the same exercise |

### 4.4 Preparation usefulness

After selected lessons, William answers a one-tap or short prompt:

```text
Did the preview make today's lesson easier to follow?
0 = not at all
1 = slightly
2 = clearly
```

Track this separately from whether the preview question was answered correctly.

### 4.5 Interruption cost

| Metric | Definition |
|---|---|
| Mute/pause events | Number and reason |
| Wrong-time rating | Message was useful in content but poorly timed |
| Ignored streak | Consecutive proactive initiations without response |
| Daily burden | Self-reported 0–2: too little / right / too much |

## 5. Weekly qualitative review

Once per week, answer:

1. Which message was most useful, and why?
2. Which message was least useful, and why?
3. Did the agent bring back something that would otherwise have been forgotten?
4. Did it prepare something genuinely relevant to a later lesson?
5. Did it misinterpret an answer or misconception?
6. Was any visualization materially better than text?
7. What did William manually study outside the agent that changes interpretation of the data?

## 6. Concept-level evaluation record

For each tracked concept:

```text
Concept:
First course exposure date:
First agent exposure date:
Attempt count:
Problem forms used:
Review intervals:
Correctness by interval:
Hints used:
Active misconception evidence:
Current estimate and confidence:
Notes on outside study:
```

Do not interpret repeated success on an identical problem as broad mastery.

## 7. Evaluation guardrails

- Do not optimize only for response rate; annoying easy questions may receive replies but produce little learning.
- Do not optimize only for correctness; the system should sometimes ask challenging diagnostic questions.
- Do not change many variables simultaneously during the pilot without recording the change.
- Version planning, review, and evaluation logic.
- Record external study, teacher changes, and test preparation that may explain performance.
- Treat self-report as useful evidence but not the only evidence.

## 8. Pilot success threshold

Proceed to a second user only when all of the following are true:

1. source and timeline accuracy are consistently high for the target course;
2. no critical grading or duplicate-message failures remain;
3. at least two concepts show useful repeated retrieval evidence;
4. William reports net positive value and keeps proactive messages enabled;
5. the system has demonstrated review, current practice, future preparation, and misconception remediation;
6. the team can explain every important decision through stored traces; and
7. the team has documented which parts required manual maintenance.

## 9. Pilot report template

```markdown
# Pilot report

## Dates

## Course coverage

## Usage summary

## Source/timeline accuracy

## Learning evidence

## Preparation evidence

## Message relevance and burden

## Major failures

## Manual work required

## What to keep

## What to remove

## What to build next

## Decision: continue / revise / stop
```

