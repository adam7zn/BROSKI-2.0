# Phase 0 boundary payloads

These two files are the contract between the backend and the conversation
runtime, as fixed by [Delivery phases](../../docs/PHASES.md) Phase 0. They are
copied verbatim from that document and are used as test fixtures by
`packages/conversation`.

| File | Direction | Produced by | Consumed by |
|---|---|---|---|
| `backend-context.example.json` | backend → conversation | `packages/backend` | `packages/conversation` |
| `conversation-result.example.json` | conversation → backend | `packages/conversation` | `packages/backend` |

Keeping them narrow is the point: the agent can be rewritten without touching
storage, and storage can move to PostgreSQL without touching the agent.

## Field notes

### `backend-context.example.json`

| Field | Type | Notes |
|---|---|---|
| `interactionId` | string | Correlation ID for the whole interaction. Person B owns it. |
| `topic` | string | Short topic label the question should stay inside. |
| `sourceText` | string | The course/textbook sentence the question must align with. |
| `difficulty` | `easy` \| `medium` \| `hard` | Person A adapts wording, not the topic. |
| `image` | string \| null | Optional image URL the conversation runtime only forwards; it never creates or stores one. |

### `conversation-result.example.json`

| Field | Type | Notes |
|---|---|---|
| `interactionId` | string | Echoed from the context payload. |
| `question` | string | Exactly what was sent to the student. |
| `studentReply` | string | Raw reply text, unedited. |
| `feedback` | string | Exactly what was sent back to the student. |
| `result` | `correct` \| `partially_correct` \| `incorrect` \| `unclear` | See below. |

`result` values beyond `correct` are needed because a real reply is often
partial or ambiguous, and [Project rules](../../docs/RULES.md) §2.8 requires the
agent to lower confidence instead of guessing. No new *fields* were added to the
Phase 0 contract.

Everything the agent knows beyond these five fields — expected answer, rubric,
evaluation confidence, prompt and model versions — travels alongside the payload
as a trace rather than inside it, and is stored with the interaction.
