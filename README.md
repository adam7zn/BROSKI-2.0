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

## First contact

The companion introduces itself and asks what to call the student, then gets to
know them. `pnpm onboard` runs it on its own; `pnpm chat` and `pnpm telegram`
run it automatically the first time they meet a conversation they have no
profile for.

With an API key this is a real conversation, not a form. One sentence can answer
several questions at once — "jag heter William, går tvåan och läser matte 2c med
5000+" is read as four things and none of them are asked about again — and as
soon as it knows the course it asks for a photo of the school's term plan,
because that one picture answers what the class is doing, when the lessons are,
and when the test is. Told there is no such plan, it drops the idea and carries
on.

Without a key it falls back to a fixed questionnaire that needs no model at all.
Both paths end in the same summary, and both write the same profile.

Whatever the model reports is read by the same deterministic parsers either way:
a course becomes `Ma2c` or stays as the student wrote it, "tis 9.15 och tors 13"
becomes two lesson slots, and something vague becomes nothing at all.

```
Broski: Hej! Jag heter Broski och ska plugga matte med dig. Vad ska jag kalla dig?
William
Broski: Trevligt att träffas! 11 korta frågor, sen sätter vi igång.
```

| Asked | Why it earns a question |
|---|---|
| What to call you | Everything else is small talk without it |
| Maths course (Ma1c, Ma2c, …) | Decides the level and the notation |
| Textbook | Questions must use the book's methods, not a generic one's |
| What you are doing right now | Where in the course to start |
| Lesson days and times | Becomes the course calendar the planner reads |
| Struggling / okay / confident | Sets the opening difficulty |
| Year, age, class | Tone, and who this profile belongs to |
| Next test | Lets preparation aim at something real |
| Quiet hours | Bounds when anything may ever be sent |
| Last grade | Optional context, and skippable by design |

Only a name is required. Every optional answer takes "hoppa över", and an answer
the companion cannot read is asked about once and then let go — a companion that
badgers is worse than one missing a field.

Free-text answers are read without a model: "tis 9.15 och tors 13" becomes two
lesson slots, "matte 2c" becomes `Ma2c`, "3 oktober" becomes a date. Anything
unrecognised is kept verbatim rather than guessed at, so an unusual course name
survives as the student wrote it.

The lesson times are written straight into `data/course-plan.json`. Their
`covers` lists stay empty: which study item a given lesson teaches is still
something only a person knows, and the companion does not invent it.

## Sending it your school's plan

Most schools hand out a plan for the term: which lesson covers what, which
pages, when the test is. That sheet is the one thing this system cannot work out
on its own, so the student can just photograph it.

Send a photo or a PDF in Telegram, or try it locally:

```bash
pnpm upload data/planering.jpg
```

The companion reads it and says what it found:

> Läste Planering Ma2c v. 35-43. Jag la in 14 lektioner med datum och vad de
> handlar om. 3 rader saknade datum, så dem lade jag bara som områden att öva på.

What it does with each kind of document:

| Sent | What happens |
|---|---|
| Term plan | Dated lessons, each knowing which topic it covers, into `data/course-plan.json` |
| Timetable | The same, where it states dates |
| Assignment or a page of the book | The text becomes something to build questions from |
| Anything else | It says what it sees and asks for the plan instead |

Two rules it will not break. A row it cannot read is left out rather than
filled in, and a week number is not a date — those rows become topics with no
place in the calendar, and it says how many. When the photo was poor it uses
what it got and tells the student to check it.

Lesson times come from the timetable given during setup: a plan that says
"tis 15/9" becomes a lesson at the time Tuesday lessons actually start. A day
with no known lesson time falls back to 08:00 rather than inventing one.

Reading a document needs `ANTHROPIC_API_KEY`. There is no offline way to read a
photo, and the companion says so rather than pretending the picture was blurry.

## Chatting with it

The companion is a chat partner first. Write anything about your maths and it
answers; write "plugga" and it gives you something to practise.

```bash
pnpm ask                       # a conversation in the terminal
pnpm ask "hur funkar pq-formeln"   # a single question
pnpm telegram                  # the same, on the phone
```

**It answers from the student's own textbook and nothing else.** Pages are
searched for the question, the ones that match are put in front of the model,
and the model is told those pages are the only source it may use. A question
the book does not cover gets said so, plainly, rather than answered from
general knowledge:

> Det där hittar jag inte i din bok. Vilket kapitel står det i?

That restriction is deliberate. A student taught one method in class and a
different one by the companion is worse off than one who got no help at all.
A page the model claims to have used but was never given is dropped from the
record, so a cited page always means a page that was really there.

### Getting the book in

```bash
pnpm index-book chapter-1
```

Every image and PDF in the folder and below it is read once and its text
stored. Chapter 1 is 60 scans split across six folders, and they are read in
page order regardless: `page-006.JPG` is cited back as "s. 6", `page-063.JPG`
as "s. 63", and a `contents-01.JPG` as "Innehåll 1" rather than as page 1.

Re-running skips pages already read, so a run that dies half way carries on
where it stopped instead of paying for the whole chapter twice. `--force`
re-reads everything.

One model call per page, so sixty pages takes a few minutes and a few dollars.

Photographing a page and sending it in Telegram adds it the same way, one page
at a time.

The scans live in the repository because it is private. In a public one they
could not: a textbook is copyrighted, and `docs/RULES.md` §8 keeps stored source
material to what the pilot needs. Only the extracted text goes in the database.

Search is a keyword score, not embeddings: the index is one chapter of one book,
it has to work with no network, and when it picks the wrong page you can read
the rule and argue with it. Swedish compounds are handled — a page about
"andragradsekvationer" answers to a question about "ekvationer" — and a
hyphenated term like "pq-formeln" is kept whole, because that is what makes it
worth searching for.

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

### On iMessage, through Sendblue

```bash
pnpm imessage
```

Same companion, different pipe. Sendblue pushes inbound messages to a webhook
rather than being polled, so the runner opens a port and waits to be called:

1. Fill in the `SENDBLUE_*` values in `.env` (see `.env.sendblue.example`)
2. `pnpm imessage` — it prints the port it is listening on
3. Forward that port publicly (in a codespace: the **Ports** tab, right-click →
   Port Visibility → Public) and copy the URL
4. Register that URL plus `/webhooks/sendblue?secret=<SENDBLUE_WEBHOOK_SECRET>`
   as the webhook in Sendblue
5. Set `MESSAGING_LIVE_ENABLED=true` when you actually want messages to reach
   the phone — until then nothing is sent

### On Telegram

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.
2. `cp .env.example .env` and paste the token into `TELEGRAM_BOT_TOKEN`.
3. `pnpm telegram` — it prints the chat id of whoever writes to the bot.
4. Put that id in `TELEGRAM_ALLOWED_CHAT_ID`; every other chat is ignored.
5. `pnpm telegram` again — it serves until you stop it. `-- --once` answers a
   single message and exits.

Every message that arrives is printed in the terminal as `<- hej`. If you write
to the bot and nothing appears there, the message never reached this process:
the wrong chat id, the wrong bot, or `pnpm telegram` is not running.

Messages that were already waiting when the runner started are not answered.
Telegram holds undelivered updates for a day, so a companion that replied to
all of them would answer four questions at once, hours after they were asked.

Unlike the iMessage path, this needs no Mac and no awake machine beyond the one
running the command.

### Known seam

The planner still reads its attempt history from a local SQLite file in
`apps/companion`, not from PostgreSQL through the API. Both stores are real;
only PostgreSQL is authoritative. See ADR-014.

## Current milestone

The Platform Phase 1 loop is persisted in PostgreSQL. The active judge MVP connects that same
canonical interaction to one hosted Sendblue iMessage conversation:

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

## Hosted Sendblue judge demo

The hosted runtime is one Render Node web service: API, authenticated Sendblue webhook, and durable
inbox/outbox worker. Copy `.env.sendblue.example` to
`apps/companion/.env.sendblue.local` only for local development; configure production secrets in
Render. Keep `MESSAGING_LIVE_ENABLED=false` until migrations, health, authentication, and fake tests
pass.

Sendblue cannot disable SMS fallback at the account level. Before every live outbound request the
adapter calls Sendblue's service lookup and proceeds only when it reports `iMessage`; response and
webhook downgrade checks then stop the session if Sendblue still reports a fallback.

The partner's existing Telegram agent behavior must move behind `ConversationAgent`. Telegram
transport calls do not move: the agent returns validated outbound intents, and the messaging worker
alone reserves and calls Sendblue. The deterministic implementation remains the integration fixture
until that migration is connected. Add `ANTHROPIC_API_KEY` only after the partner implementation is
ready.

After deploying `render.yaml`, configure Sendblue `receive` and `outbound` webhooks to
`https://<render-host>/webhooks/messaging/sendblue` using the same secret stored as
`SENDBLUE_WEBHOOK_SECRET`. Account-level webhooks require application-side sender and line filters,
which this service enforces. The operator command starts a fresh interaction and launches its first
outbound intent:

```bash
MSC_API_URL=https://<render-host> INTERNAL_API_TOKEN=<token> pnpm demo:sendblue
```

For the controlled phone test, enable `MESSAGING_LIVE_ENABLED=true`, launch one interaction, reply
from only the configured recipient, verify delivery remains iMessage, replay the webhook to prove
deduplication, and inspect the authenticated interaction/events/messaging routes. Disable live
messaging immediately afterward. Automated tests never call Sendblue, Render, or hosted Supabase.
