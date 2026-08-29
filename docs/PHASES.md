# Delivery Phases

This is the implementation order for the project. Work only on the current phase. The larger architecture documents are reference material, not a reason to build future features early.

## Fixed two-person split

| Owner | Owns now | Does not own now |
|---|---|---|
| Person A — Conversation | messaging, conversation state, and one simple agent | database, backend jobs, images, imports, or deployment |
| Person B — Platform and visuals | backend, database, APIs, images, files, logs, and deployment | prompts, message wording, or agent behavior |

This boundary stays fixed through the first real-message demo.

## Phase 0 — Freeze the boundary

### Goal

Let both people start without waiting for each other.

### First step

Agree on only two payloads. Save one example of each as fixtures.

Backend to conversation:

```json
{
  "interactionId": "demo-001",
  "topic": "linear equations",
  "sourceText": "Solve equations by applying the same operation to both sides.",
  "difficulty": "easy",
  "image": null
}
```

Conversation to backend:

```json
{
  "interactionId": "demo-001",
  "question": "Solve 2x + 3 = 11.",
  "studentReply": "x = 4",
  "feedback": "Correct — subtract 3, then divide by 2.",
  "result": "correct"
}
```

Person B may later supply an image reference in `image`. Person A only displays or sends it; Person A does not create or store it.

### Done when

- both example payloads exist;
- both people can explain which fields they produce and consume;
- neither side needs to import code from the other side.

Do not design more contracts in this phase.

## Phase 1 — Prove both halves separately

The two people work in parallel. Every missing dependency is a fixture or fake.

### Person A — Messaging and simple agent

Build one tiny conversation loop:

1. load the example backend payload;
2. create one maths question;
3. send it through a fake messenger or local chat screen;
4. accept one reply;
5. return short feedback;
6. produce the example result payload.

The agent is deliberately simple: one question, one reply, one evaluation, one feedback message. No tools, retrieval, memory, planning, multiple agents, or autonomous follow-up.

### Person B — Backend, data, and images

Build one tiny backend loop:

1. expose a manual start action;
2. return the example backend payload;
3. accept a fake result payload;
4. save the complete interaction;
5. show the saved record in a log, database query, or minimal admin view;
6. support one static image reference without generating a visual yet.

The backend does not decide how the agent speaks or whether an answer is correct.

### Done when

- Person A can demonstrate the full fake conversation without the real backend;
- Person B can demonstrate create-and-save without the real agent;
- both demonstrations use the exact Phase 0 payloads.

Nothing needs to run across both code paths yet.

## Phase 2 — Connect the halves locally

### Goal

Replace the two fakes at the boundary and change nothing else.

### Integration order

1. Person A requests one context payload from Person B.
2. Person A runs the one-question conversation.
3. Person A posts one result payload to Person B.
4. Person B saves it.
5. Both inspect the same `interactionId` from start to finish.

### Done when

```text
manual start
→ backend returns context
→ simple agent asks one question
→ student replies
→ agent sends feedback
→ backend saves the interaction
```

Use fake/local messaging for this phase. A real messaging provider is not required.

## Phase 3 — One real message

### Person A

- move the existing Telegram agent behavior behind `ConversationAgent` without moving Telegram transport calls;
- put the conversation loop behind the hosted Sendblue adapter;
- handle one inbound reply;
- keep the wording short and predictable;
- keep the fake adapter for tests.

### Person B

- host the API, authenticated Sendblue webhook, and durable worker as one Render service;
- add basic secrets, logs, and delivery-event storage;
- serve an image when the context contains one;
- keep starting the interaction manually.

### Done when

William receives one question on a real device, replies once, receives feedback, and the backend stores the full interaction exactly once.

No schedules, Canvas synchronization, learning model, dashboard, or multi-user support.

## Phase 4 — Make the loop useful

Only start this phase after the real-message loop is stable.

### Person A

- improve the single agent's prompt and reply handling;
- support an ambiguous reply and a hint request;
- keep the interaction to one study item at a time.

### Person B

- add a small, manually curated set of real course and textbook context;
- store prior attempts and provide the most relevant history;
- add verified image generation or deterministic rendering where an image materially helps;
- add a minimal operational view for failed or duplicated interactions.

### Done when

Ten manually started interactions use real material and can be reviewed from source context through saved result.

## Phase 5 — Add timing carefully

Person B adds schedules, quiet hours, caps, pause controls, and retries. Person A adds the small amount of agent behavior required for reminders. Start in shadow mode, then approval mode, before any automatic sending.

### Done when

- every proposed message has a visible reason;
- no message is sent outside quiet-hour and daily-cap rules;
- duplicate triggers cannot create duplicate messages;
- the whole system can be paused immediately.

## Phase 6 — Expand from evidence

Consider Canvas synchronization, richer textbook ingestion, adaptive review, generated visuals, dashboards, and additional users only after the earlier phases show a concrete need.

## Scope gate

If a task is not necessary for the current phase's done condition, put it in the backlog and continue without it.
