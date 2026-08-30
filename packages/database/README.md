# Phase 1 database package

This package stores the two Phase 0 payloads, the narrow Phase 3 hosted-messaging state, and the
Phase 4 manually verified exercise catalog. PostgreSQL owns the interaction, profile, normalized
delivery events, outbound reservations, messaging session, minimized inbox, outbox, exercise
review evidence, and interaction-to-exercise provenance. It still has no learning-memory,
scheduler, or mastery tables.

## Local PostgreSQL and migrations

From the repository root:

```sh
pnpm --filter @math-study-companion/database db:up
pnpm --filter @math-study-companion/database db:migrate
pnpm --filter @math-study-companion/database db:migration-status
```

The local container listens only on `127.0.0.1:54329` and uses PostgreSQL
`trust` authentication for this disposable local database. For another
database, set `DATABASE_URL` in the shell; do not commit credentials.

Run the repository integration tests against the local container with:

```sh
pnpm --filter @math-study-companion/database test:local
```

Import the locally generated Chapter 1 OCR from the repository root with:

```sh
pnpm --filter @math-study-companion/database db:import-chapter ../../chapter-1/extracted/chapter-1-ocr.json
```

Imported pages retain their source image path, OCR confidence, and review
metadata. The importer leaves `verified_at` unset; OCR text must not be treated
as exact textbook content until a reviewer has checked the mathematical
notation and reading order.

After importing structured source content, import the private pilot manifest as drafts:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/math_study_companion \
  pnpm --filter @math-study-companion/database db:import-exercise-drafts -- \
  data/private-exercise-drafts.json
```

The manifest schema enforces exactly 20 independent items: sections 1.1/1.2/1.3 contain 6/7/7,
and difficulty contains 10 easy, 6 medium, and 4 hard items. Re-importing identical drafts is
idempotent; conflicting content fails. Imports never mark an exercise verified. Approval,
correction, or rejection is recorded by the authenticated local review service, and review rows are
append-only. Page images and `data/private-*.json` stay out of Git.

The draft importer accepts only a loopback database and cannot be overridden for hosted use. After
all 20 local reviews are complete, publish only the human-verified snapshots through a separately
reviewed hosted operation, after the exact migration ledger and target have been reported and
William has approved both the migration and publication.

Use `db:down` to stop the container. The named volume remains so migration
history and data survive restarts.

## Supabase

Production-style Phase 1 persistence uses the `Math Study Companion` Supabase PostgreSQL project.
Provide `DATABASE_URL` as a deployment secret, copy `.env.example` to the ignored `.env.supabase`,
or use the configured macOS Keychain item, then run:

```sh
pnpm db:migrate:supabase
```

The same forward-only migration runner is used locally and on Supabase, including checksum checks
and a PostgreSQL advisory lock. Do not use `supabase db reset` against the hosted project. Supabase
credentials remain outside the repository, and CI continues to migrate a disposable PostgreSQL 17
service instead of the hosted database.

Before any hosted migration, run `pnpm db:migration-status:supabase`. The command is read-only and
prints local migrations as `applied`, `pending`, or `checksum_mismatch`, plus any hosted-only ledger
names. A historical `0002_add_completed_at.sql` row with the same checksum as the current
`0003_add_completed_at.sql` is reported as `applied_alias`; the runner leaves that evidence intact
and safely applies the idempotent current filename as a forward ledger entry. Never rename, delete,
or rewrite either applied record to make the lists look alike.

## API integration

The API owns a narrow adapter around `PostgresInteractionRepository`; callers do not import the
database shape into route or application logic. `complete` receives the accepted completion time,
and completion is first-write-only under a row lock. Concurrent or repeated results receive
`DUPLICATE_RESULT` and cannot overwrite the original evidence or timestamp.

The hosted inbox and outbox use transactional `FOR UPDATE SKIP LOCKED` claims. A stale claim may be
recovered after restart, but an outbound reservation that already exists is marked uncertain and is
never sent again automatically.
