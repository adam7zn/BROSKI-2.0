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

## Two-person team workstreams

- **Person A — Conversation:** messaging, conversation state, and one simple question-and-feedback agent.
- **Person B — Platform and visuals:** backend, database, APIs, images, files, logs, and deployment.

The first phases use only two shared payloads so both people can build independently with fixtures. [Delivery phases](docs/PHASES.md) is the source of truth for current work. [Team ownership](docs/TEAM_OWNERSHIP.md) records broader responsibilities that may become useful after the first real-message loop works.

## Current milestone

The Platform Phase 1 loop is persisted in Supabase. The active judge MVP connects that same
canonical interaction to one real iMessage conversation:

```text
backend context
→ short onboarding and one simple question
→ student reply
→ useful feedback
→ saved profile, delivery events, and interaction
```

See [Delivery phases](docs/PHASES.md) for implementation order. The [Initial backlog](docs/INITIAL_BACKLOG.md) is deferred reference material for later phases.

## Development

The repository uses Node.js 22 or newer and pnpm. From a clean checkout:

| Task | Command |
|---|---|
| Install dependencies | `pnpm install --frozen-lockfile` |
| Format files | `pnpm format` |
| Check formatting | `pnpm format:check` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Start the local test PostgreSQL | `pnpm db:up` |
| Apply migrations locally | `pnpm db:migrate` |
| Run all tests (PostgreSQL must be running) | `pnpm test` |
| Run every required check | `pnpm check` |
| Build the API | `pnpm --filter @math-study-companion/api build` |
| Extract Chapter 1 with Apple Vision | `swift scripts/structured-ocr.swift --input chapter-1 --output chapter-1/extracted/checkpoints` |
| Assemble structured extraction JSON | `pnpm extract:chapter -- --checkpoints chapter-1/extracted/checkpoints --output chapter-1/extracted/chapter-1-structured.json --pix2tex` |
| Import structured Chapter 1 content | `pnpm --filter @math-study-companion/database db:import-structured-chapter -- chapter-1/extracted/chapter-1-structured.json` |
| Start local review API | `ADMIN_TOKEN=<local-token> pnpm review-api:dev` |
| Start local review UI | `pnpm admin:dev` |
| Apply migrations to Supabase | `pnpm db:migrate:supabase` |
| Start the API with Supabase | `pnpm api:start:supabase` |
| Run the canonical hosted demo | `pnpm demo:supabase` |
| Clear only the local synthetic fixture | `pnpm demo:clear:local -- --confirm demo-001` |
| Run the real iMessage demo | `caffeinate -i pnpm demo:imessage` |

The hosted project is `Math Study Companion` (`leknhhxqqehwiaxvzwnt`) in `eu-west-1`. Deployments
provide its complete `DATABASE_URL` as a secret. For local use, either copy `.env.example` to the
ignored `.env.supabase` file and replace the password placeholder, or let the hosted scripts read the
`math-study-companion-supabase-db` item from macOS Keychain. Never commit the password or connection
URL. The API uses Supabase's IPv4 Session pooler with
`sslmode=require&uselibpqcompat=true`; local Docker remains the isolated database for tests and CI.

For the hosted Phase 1 Platform demonstration, build the API, run `pnpm db:migrate:supabase`, start
it with `pnpm api:start:supabase`, and then run `pnpm demo:supabase`. Restart the API and retrieve
`demo-001` again to confirm persistence. The canonical curl commands are in
[`apps/api/README.md`](apps/api/README.md).

For isolated checks, run `pnpm db:up`, `pnpm db:migrate`, and `pnpm check`, then stop the disposable
service with `pnpm db:down`. CI follows this local path and never connects to Supabase.

## Judge iMessage demo

The real-message adapter uses the official
[`imessage-cli`](https://github.com/beeper/platform-imessage) locally. Sign Messages.app on this Mac
into the dedicated companion Apple ID and keep the demo phone on a separate identity. Apple
credentials are never copied into this repository.

```bash
brew install beeper/tap/imessage-cli
imessage-cli authorize all
imessage-cli --json current-user
cp .env.imessage.example .env.imessage.local
# Edit only MSC_IMESSAGE_RECIPIENT in the ignored local file.

pnpm db:migrate:supabase
pnpm --filter @math-study-companion/api build
pnpm api:start:supabase
```

With the API still running, use a second terminal. The runner creates a fresh `judge-<UUID>`
interaction by default so rehearsals never need to delete hosted data:

```bash
caffeinate -i pnpm demo:imessage
# Copy interactionId from the runner's final JSON output.
curl -s http://127.0.0.1:3000/internal/demo/<interactionId> | jq
curl -s http://127.0.0.1:3000/internal/demo/<interactionId>/events | jq
curl -s http://127.0.0.1:3000/internal/demo/profile | jq
```

`MSC_INTERACTION_ID` may pin a readable ID for one clean recording, but it must be unused. The
cleanup command is deliberately local-only: it refuses non-local database hosts and accepts only
`demo-001`. Hosted Supabase is never reset, truncated, or used as a test fixture. The live demo is
manual and single-user; CI uses the fake provider.
