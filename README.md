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

## Layout

```text
packages/contracts/      the payloads that cross every boundary
packages/database/       PostgreSQL migrations and repositories
packages/ingestion/      textbook extraction (Apple Vision + pix2tex)
packages/conversation/   study agent, messaging adapters, the conversation loop
packages/planning/       course timeline, review scheduling, the study planner
apps/api/                HTTP API and the review endpoints
apps/admin/              content review UI
apps/companion/          runnable entry points: plan, chat, telegram, imessage
```

## The study loop

Two paths run today. The judge demo is the canonical one, scripted end to end
over iMessage and PostgreSQL. The agent path is the product one:

```bash
pnpm plan      # what it would do for the next week, and why — sends nothing
pnpm chat      # the whole conversation in a terminal, no accounts needed
pnpm telegram  # the same conversation over Telegram
pnpm inspect   # what was asked, answered, and judged
```

`pnpm chat` works with no credentials at all: without `ANTHROPIC_API_KEY` it
falls back to a scripted fixture agent, so messaging, correlation, and storage
can be exercised offline.

### What it decides, and why

Every interaction starts from the date, the course calendar in
`data/course-plan.json`, and the attempt record — not from a rotation:

| Mode | When | What it asks |
|---|---|---|
| `PREPARE` | a lesson starts within 24 hours | the prerequisite that lesson is built on |
| `PRACTISE` | a lesson ended within 48 hours | whether the central idea stuck |
| `REVIEW` | otherwise | whatever the record says is due, most overdue first |
| — | nothing due, no lesson near | nothing at all |

Review intervals come from what he actually answered: doubling while he is
right (up to 21 days), collapsing to a day when he is wrong, and untouched by an
answer nobody could read. `pnpm plan` prints all of it as sentences.

### The conversation

One study item, as many turns as it takes. He can answer, ask for a hint, say he
is stuck, or write something unreadable; hints escalate and then stop, and only
a real judgement ends the interaction and becomes an attempt. A hint request is
never recorded as a wrong answer.

### On Telegram

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.
2. `cp .env.example .env` and paste the token into `TELEGRAM_BOT_TOKEN`.
3. `pnpm telegram` — it prints the chat id of whoever writes to the bot.
4. Put that id in `TELEGRAM_ALLOWED_CHAT_ID`; every other chat is ignored.
5. `pnpm telegram` again to run one interaction, `-- --loop` to keep serving.

Unlike the iMessage path, this needs no Mac and no awake machine beyond the one
running the command.

### Known seam

The planner still reads its attempt history from a local SQLite file in
`apps/companion`, not from PostgreSQL through the API. Both stores are real;
only PostgreSQL is authoritative. See ADR-014.

## Current milestone

The Platform Phase 1 loop is persisted in PostgreSQL, and the Phase 3 Sendblue slice connects that
same interaction to one hosted iMessage conversation. Phase 4 is now implemented behind manual and
human-review gates: a reviewer approves a private textbook exercise, an operator selects it by ID,
and the existing durable messaging loop can use Claude for hints and feedback without allowing the
model to rewrite the question.

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
| Inspect the local migration ledger | `pnpm db:migration-status` |
| Run all tests (PostgreSQL must be running) | `pnpm test` |
| Run every required check | `pnpm check` |
| Build the API | `pnpm --filter @math-study-companion/api build` |
| Extract Chapter 1 with Apple Vision | `swift scripts/structured-ocr.swift --input chapter-1 --output chapter-1/extracted/checkpoints` |
| Assemble structured extraction JSON | `pnpm extract:chapter -- --checkpoints chapter-1/extracted/checkpoints --output chapter-1/extracted/chapter-1-structured.json --pix2tex` |
| Import structured Chapter 1 content | `pnpm --filter @math-study-companion/database db:import-structured-chapter -- chapter-1/extracted/chapter-1-structured.json` |
| Import the private 20-exercise draft manifest | `pnpm --filter @math-study-companion/database db:import-exercise-drafts -- data/private-exercise-drafts.json` |
| Start local review API | `ADMIN_TOKEN=<local-token> pnpm review-api:dev` |
| Start local review UI | `pnpm admin:dev` |
| Apply migrations to Supabase | `pnpm db:migrate:supabase` |
| Inspect Supabase migration state (read-only) | `pnpm db:migration-status:supabase` |
| Start the API with Supabase | `pnpm api:start:supabase` |
| Run the canonical hosted demo | `pnpm demo:supabase` |
| Clear only the local synthetic fixture | `pnpm demo:clear:local -- --confirm demo-001` |
| Run the real iMessage demo | `caffeinate -i pnpm demo:imessage` |
| Queue the hosted Sendblue demo | `pnpm demo:sendblue` |

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

## Verified textbook exercise pilot

Migration `0011_create_verified_exercises.sql` adds the private exercise catalog, append-only review
evidence, and the durable interaction-to-exercise link. The private pilot manifest is intentionally
ignored by Git. Importing it creates only `draft` rows. In the local review UI, William must compare
the original page crop with the direct question, expected answer, solution, and rubric, then approve,
correct, or reject each item. Only a reviewed `verified` row appears in the launch catalog.

The authenticated manual flow is:

```text
GET  /internal/exercises
POST /internal/exercises/:exerciseId/start?interactionId=<fresh-id>
POST /internal/demo/:interactionId/launch
```

The start route preserves the approved prompt exactly. Set
`CONVERSATION_AGENT_PROVIDER=anthropic`, `MSC_MODEL=claude-sonnet-5`, and the secret
`ANTHROPIC_API_KEY` to use Claude. An explicit Anthropic selection fails startup if the key is
missing and never falls back silently. On each model turn Claude receives only the selected prompt,
expected answer, rubric, and relevant transcript—not the page image, surrounding page, or book.
Once that exercise is completed, the same iMessage conversation accepts bounded related follow-up
questions. These create durable message turns without changing the first accepted result. Unrelated
or low-confidence requests receive a fixed boundary, and selecting a different exercise remains a
manual authenticated action.

Keep both `CONVERSATION_AGENT_PROVIDER=deterministic` and `MESSAGING_LIVE_ENABLED=false` for the
first deployment. Hosted migration, hosted draft import, Anthropic activation, and any real send
remain separate approval gates.

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

## Hosted Sendblue judge demo

The hosted runtime is one Render Node web service: API, authenticated Sendblue webhook, and durable
inbox/outbox worker. Copy `.env.sendblue.example` to
`apps/companion/.env.sendblue.local` only for local development; configure production secrets in
Render. Keep `MESSAGING_LIVE_ENABLED=false` until migrations, health, authentication, and fake tests
pass.

Every `/internal/*` call must use `INTERNAL_API_TOKEN` as a bearer token.
`GET /internal/messaging/status` reports the kill-switch state without secrets, and
`GET /internal/messaging/status?verifyProvider=true` performs a read-only Sendblue lookup so the
operator can confirm `iMessage` before enabling live delivery.

Sendblue cannot disable SMS fallback at the account level. Before every live outbound request the
adapter calls Sendblue's service lookup and proceeds only when it reports `iMessage`; response and
webhook downgrade checks then stop the session if Sendblue still reports a fallback.

After deploying `render.yaml`, configure Sendblue `receive` and `outbound` webhooks to
`https://<render-host>/webhooks/messaging/sendblue` using the same secret stored as
`SENDBLUE_WEBHOOK_SECRET`. The operator command starts a fresh interaction and launches its first
validated agent intent:

```bash
MSC_API_URL=https://<render-host> INTERNAL_API_TOKEN=<token> pnpm demo:sendblue
```

For the controlled phone test, enable `MESSAGING_LIVE_ENABLED=true`, launch one interaction, reply
from only the configured recipient, verify delivery remains iMessage, replay the webhook to prove
deduplication, and inspect the authenticated interaction/events/messaging routes. Disable live
messaging immediately afterward. Automated tests never call Sendblue, Render, or hosted Supabase.

`render.yaml` uses Render's free web-service plan. Because Render reserves pre-deploy commands for
paid services, the start command runs the checksum-verified, advisory-lock migration runner before
starting the API. Therefore the service must not be deployed or restarted with new migrations until
the read-only local-versus-hosted ledger report has been reviewed and the exact pending forward
migrations have explicit approval. Set the operator-managed `MESSAGING_LIVE_ENABLED` value to
`false` when creating the Blueprint. Changing it to `true` and running the operator command are
separate approval-gated actions.
