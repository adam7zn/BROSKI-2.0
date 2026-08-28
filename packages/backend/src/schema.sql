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
  question          TEXT,
  expected_answer   TEXT,
  rubric            TEXT,
  status            TEXT NOT NULL,          -- planned | sent | answered | no_reply
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
