# Math Study Companion

A personal, timeline-aware mathematics study companion for one student, one course, and one textbook.

The companion combines the current course plan, textbook content, and the student's previous answers to decide what is most useful now: retrieve an older concept, practise current material, prepare for an upcoming lesson, diagnose a misconception, explain a concept, or stay silent.

## Product goal

The student should rarely need to explain what they are studying. The system should already know:

- what the class covered previously;
- what the class is studying now;
- what is coming next;
- which textbook material corresponds to each lesson;
- which concepts the student remembers or struggles with;
- when a short study interaction would be useful.

The first complete loop is:

```text
course timeline + textbook + learning history
                    ↓
          choose the next study item
                    ↓
              send a question
                    ↓
             evaluate the reply
                    ↓
       store evidence and schedule review
                    ↓
               send feedback
```

## Documentation

| Document | Purpose |
|---|---|
| [Product requirements](docs/PRD.md) | Product scope, experience, requirements, and success criteria |
| [Architecture](docs/ARCHITECTURE.md) | Services, data flow, repository structure, and deployment design |
| [Delivery phases](docs/PHASES.md) | Milestones, dependencies, and exit criteria |
| [Project rules](docs/RULES.md) | Product, learning, AI, data, engineering, and collaboration rules |
| [Team ownership](docs/TEAM_OWNERSHIP.md) | Workstream ownership and contracts for two contributors |
| [Data model](docs/DATA_MODEL.md) | Course, content, learning, messaging, and operational entities |
| [Integrations and API](docs/INTEGRATIONS_AND_API.md) | Canvas, textbook, messaging, scheduler, and model interfaces |
| [Evaluation](docs/EVALUATION.md) | Pilot stages, measures, and success thresholds |
| [Security and privacy](docs/SECURITY_PRIVACY.md) | Personal data, credentials, textbook handling, retention, and deletion |
| [Decision log](docs/DECISIONS.md) | Accepted architectural decisions and unresolved choices |
| [Initial backlog](docs/INITIAL_BACKLOG.md) | Issue-ready work grouped by milestone and owner |

## MVP boundaries

The first version supports:

- one student: William;
- one mathematics course;
- one exact textbook;
- one course plan, initially imported manually if needed;
- one provider-neutral messaging interface;
- short review, practice, and preparation interactions;
- evidence-based review scheduling and misconception tracking.

It does not initially support multiple schools, a general textbook marketplace, every subject, high-stakes grading, or fully autonomous messaging without a shadow-mode pilot.

## Running it

Requires Node 22 or later.

```bash
npm install
npm run chat      # the whole loop in a terminal, no accounts needed
npm run inspect   # what was asked, answered, and judged
npm test
```

`npm run chat` works with no credentials at all: without `ANTHROPIC_API_KEY` it
falls back to a scripted fixture agent that generates drills, so the messaging,
correlation, and storage paths can be exercised offline.

### Where it runs

A Telegram bot has no behaviour of its own. @BotFather only registers a name and
hands out a token — the bot stays silent until this code is running somewhere
and polling Telegram for messages. Nothing runs on Telegram's servers.

So the companion needs a machine that is switched on while the student is
expected to answer:

| Where | Good for | Not good for |
|---|---|---|
| A personal computer | trying it out, curating material | nudges while the machine is asleep |
| GitHub Codespaces (browser) | a locked-down or school computer | staying awake — it stops when idle |
| An always-on box: old laptop, Raspberry Pi, small VPS | the real pilot | nothing, this is the destination |

#### From a browser, with GitHub Codespaces

The repository carries a devcontainer, so a codespace boots with Node 22 and the
dependencies installed. On the repository page: **Code → Codespaces → Create
codespace on drain**, then in its terminal:

```bash
npm run chat
npm run telegram
```

Put the token and key in **Settings → Codespaces → Secrets** on GitHub rather
than in a `.env` file; they arrive as environment variables and are never
committed. A codespace stops after about 30 minutes of inactivity, which makes
it right for trying the loop and wrong for scheduled nudges.

### On Telegram

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.
2. `cp .env.example .env` and paste the token into `TELEGRAM_BOT_TOKEN`.
3. `npm run telegram` — it prints the chat id of whoever writes to the bot.
4. Put that id in `TELEGRAM_ALLOWED_CHAT_ID`; every other chat is ignored.
5. `npm run telegram` again to run one interaction, or `-- --loop` to keep serving.

Add `ANTHROPIC_API_KEY` to `.env` for real questions about real material. Edit
`data/study-plan.json` to point the companion at the actual course content —
that file is what the questions are built from.

Starting an interaction is still manual. Nothing sends on a schedule until the
quiet hours, caps, and pause controls of [Phase 5](docs/PHASES.md) exist.

### Layout

```text
packages/conversation/   study agent, messaging adapters, the interaction loop
packages/backend/        SQLite record, study-item selection
apps/companion/          runnable entry points: chat, telegram, inspect
data/                    study plan and the local database
fixtures/contracts/      the two boundary payloads
```

## Current milestone

This manually triggered loop runs today, in a terminal and on Telegram:

```text
study plan
→ one question
→ student reply
→ deterministic check, then model judgement
→ useful feedback
→ saved interaction
```

Next: real course material in `data/study-plan.json`, then the timing work in
[Phase 5](docs/PHASES.md). The [Initial backlog](docs/INITIAL_BACKLOG.md) is
deferred reference material for later phases.
