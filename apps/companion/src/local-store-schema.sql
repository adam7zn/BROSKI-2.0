-- The pilot store. SQLite now; the column shapes follow docs/DATA_MODEL.md so
-- the move to PostgreSQL (ADR-004) is a migration, not a redesign.

CREATE TABLE IF NOT EXISTS interactions (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  conversation_id   TEXT NOT NULL,
  study_item_id     TEXT,
  topic             TEXT NOT NULL,
  source_text       TEXT NOT NULL,
  difficulty        TEXT NOT NULL,
  image             TEXT,
  mode              TEXT NOT NULL DEFAULT 'PRACTISE',  -- PREPARE | PRACTISE | REVIEW
  reason            TEXT NOT NULL DEFAULT '',           -- why this, why now
  lesson_id         TEXT,
  question          TEXT,
  expected_answer   TEXT,
  rubric            TEXT,
  status            TEXT NOT NULL,          -- planned | sent | answered | no_reply
  transcript        TEXT,                   -- JSON: the whole conversation
  trace             TEXT                    -- JSON: docs/ARCHITECTURE.md §11
);

-- Raw evidence, kept separate from anything derived from it (ADR-005).
CREATE TABLE IF NOT EXISTS attempts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  interaction_id    TEXT NOT NULL REFERENCES interactions(id),
  student_reply     TEXT NOT NULL,
  result            TEXT NOT NULL,          -- correct | partially_correct | incorrect | unclear
  feedback          TEXT NOT NULL,
  confidence        REAL NOT NULL,
  deterministic     INTEGER NOT NULL,
  hints_given       INTEGER NOT NULL DEFAULT 0,
  student_turns     INTEGER NOT NULL DEFAULT 1,
  agent             TEXT NOT NULL,
  model             TEXT,
  prompt_version    TEXT NOT NULL,
  evaluated_at      TEXT NOT NULL
);

-- Durable send ledger: survives a restart, so a resumed run cannot send the
-- same question twice (docs/RULES.md §4.4).
CREATE TABLE IF NOT EXISTS sent_messages (
  idempotency_key     TEXT PRIMARY KEY,
  interaction_id      TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  sent_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS interactions_created_at ON interactions(created_at);
CREATE INDEX IF NOT EXISTS attempts_interaction ON attempts(interaction_id);

-- Who the companion is talking to. One row per conversation; the profile is
-- replaced wholesale when the student corrects something.
CREATE TABLE IF NOT EXISTS student_profiles (
  conversation_id   TEXT PRIMARY KEY,
  profile           TEXT NOT NULL,      -- JSON: StudentProfile
  updated_at        TEXT NOT NULL
);

-- Pages of the student's own textbook, read once and searched at every turn.
-- The images themselves stay on disk and out of git: they are copyrighted, and
-- docs/RULES.md §8.2 keeps stored source material to what the pilot needs.
CREATE TABLE IF NOT EXISTS book_pages (
  id            TEXT PRIMARY KEY,      -- file name, or the message it arrived in
  label         TEXT NOT NULL,         -- what to call it: "s. 84", "kap 3"
  text          TEXT NOT NULL,         -- what the page says
  source_kind   TEXT NOT NULL,         -- indexed | uploaded
  indexed_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS book_pages_indexed_at ON book_pages(indexed_at);
