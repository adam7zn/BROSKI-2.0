-- Phase 1 persistence only. Future domain entities intentionally do not belong here.
CREATE TABLE interactions (
  interaction_id text CONSTRAINT interactions_pkey PRIMARY KEY,
  topic text NOT NULL,
  source_text text NOT NULL,
  difficulty text NOT NULL,
  image text,
  question text,
  student_reply text,
  feedback text,
  result text,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT interactions_interaction_id_not_blank
    CHECK (btrim(interaction_id) <> ''),
  CONSTRAINT interactions_trace_id_not_blank
    CHECK (btrim(trace_id) <> ''),
  CONSTRAINT interactions_completion_is_all_or_nothing
    CHECK (
      (question IS NULL AND student_reply IS NULL AND feedback IS NULL AND result IS NULL)
      OR
      (question IS NOT NULL AND student_reply IS NOT NULL AND feedback IS NOT NULL AND result IS NOT NULL)
    )
);

COMMENT ON TABLE interactions IS
  'Phase 1 demonstration records: one exact context payload plus one exact result payload.';

CREATE INDEX interactions_recent_idx
  ON interactions (created_at DESC, interaction_id DESC);
