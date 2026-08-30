-- Phase 4 manually curated textbook exercises. Migration 0010 belongs to the
-- independent Canvas timeline slice and is intentionally not rewritten here.
CREATE TABLE exercises (
  id uuid PRIMARY KEY,
  source_page_id uuid NOT NULL REFERENCES source_pages(id) ON DELETE RESTRICT,
  source_block_id uuid REFERENCES source_blocks(id) ON DELETE SET NULL,
  source_bounding_box jsonb NOT NULL,
  section_code text NOT NULL,
  section_title text NOT NULL,
  exercise_number text NOT NULL,
  part_label text NOT NULL DEFAULT '',
  topic text NOT NULL,
  prompt text NOT NULL,
  answer_payload jsonb NOT NULL,
  solution_text text NOT NULL,
  rubric text NOT NULL,
  difficulty text NOT NULL,
  grading_strategy text NOT NULL,
  verification_state text NOT NULL DEFAULT 'draft',
  content_checksum text NOT NULL,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT exercises_section_code_valid
    CHECK (btrim(section_code) <> '' AND length(section_code) <= 20),
  CONSTRAINT exercises_section_title_valid
    CHECK (btrim(section_title) <> '' AND length(section_title) <= 120),
  CONSTRAINT exercises_number_valid
    CHECK (btrim(exercise_number) <> '' AND length(exercise_number) <= 40),
  CONSTRAINT exercises_part_label_valid CHECK (length(part_label) <= 20),
  CONSTRAINT exercises_topic_valid
    CHECK (btrim(topic) <> '' AND length(topic) <= 160),
  CONSTRAINT exercises_prompt_valid
    CHECK (btrim(prompt) <> '' AND length(prompt) <= 18996),
  CONSTRAINT exercises_solution_valid
    CHECK (btrim(solution_text) <> '' AND length(solution_text) <= 18996),
  CONSTRAINT exercises_rubric_valid
    CHECK (btrim(rubric) <> '' AND length(rubric) <= 4000),
  CONSTRAINT exercises_difficulty_valid
    CHECK (difficulty IN ('easy', 'medium', 'hard')),
  CONSTRAINT exercises_grading_strategy_valid
    CHECK (grading_strategy IN ('numeric', 'symbolic', 'multiple_choice', 'rubric')),
  CONSTRAINT exercises_verification_state_valid
    CHECK (verification_state IN ('draft', 'verified', 'rejected')),
  CONSTRAINT exercises_answer_payload_valid CHECK (
    jsonb_typeof(answer_payload) = 'object'
    AND jsonb_typeof(answer_payload -> 'canonical') = 'string'
    AND btrim(answer_payload ->> 'canonical') <> ''
    AND jsonb_typeof(answer_payload -> 'accepted') = 'array'
  ),
  CONSTRAINT exercises_bbox_valid CHECK (
    jsonb_typeof(source_bounding_box) = 'array'
    AND jsonb_array_length(source_bounding_box) = 4
    AND (source_bounding_box ->> 0)::numeric >= 0
    AND (source_bounding_box ->> 1)::numeric >= 0
    AND (source_bounding_box ->> 2)::numeric > 0
    AND (source_bounding_box ->> 3)::numeric > 0
    AND (source_bounding_box ->> 0)::numeric
      + (source_bounding_box ->> 2)::numeric <= 1.000001
    AND (source_bounding_box ->> 1)::numeric
      + (source_bounding_box ->> 3)::numeric <= 1.000001
  ),
  CONSTRAINT exercises_checksum_valid
    CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT exercises_verification_consistent CHECK (
    (verification_state = 'verified'
      AND verified_at IS NOT NULL
      AND verified_by IS NOT NULL
      AND btrim(verified_by) <> '')
    OR
    (verification_state <> 'verified'
      AND verified_at IS NULL
      AND verified_by IS NULL)
  ),
  CONSTRAINT exercises_source_identity_unique
    UNIQUE (source_page_id, exercise_number, part_label)
);

CREATE TABLE exercise_reviews (
  id uuid PRIMARY KEY,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  decision text NOT NULL,
  snapshot jsonb NOT NULL,
  content_checksum text NOT NULL,
  reviewer text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT exercise_reviews_decision_valid
    CHECK (decision IN ('approve', 'correct', 'reject')),
  CONSTRAINT exercise_reviews_snapshot_valid
    CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT exercise_reviews_checksum_valid
    CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT exercise_reviews_reviewer_valid
    CHECK (btrim(reviewer) <> '' AND length(reviewer) <= 120),
  CONSTRAINT exercise_reviews_notes_valid
    CHECK (notes IS NULL OR length(notes) <= 2000)
);

ALTER TABLE interactions
  ADD COLUMN exercise_id uuid REFERENCES exercises(id) ON DELETE RESTRICT;

CREATE INDEX exercises_verified_catalog_idx
  ON exercises (section_code, difficulty, exercise_number, part_label)
  WHERE verification_state = 'verified';
CREATE INDEX exercises_source_page_idx
  ON exercises (source_page_id, exercise_number, part_label);
CREATE INDEX exercise_reviews_exercise_idx
  ON exercise_reviews (exercise_id, created_at DESC, id DESC);
CREATE INDEX interactions_exercise_idx
  ON interactions (exercise_id) WHERE exercise_id IS NOT NULL;

CREATE TRIGGER exercise_reviews_append_only
  BEFORE UPDATE OR DELETE ON exercise_reviews
  FOR EACH ROW EXECUTE FUNCTION prevent_source_evidence_mutation();

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE exercises, exercise_reviews FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE exercises, exercise_reviews FROM authenticated;
  END IF;
END
$$;

COMMENT ON TABLE exercises IS
  'Private textbook exercises that remain unusable until explicit human verification.';
COMMENT ON TABLE exercise_reviews IS
  'Append-only human approval, correction, and rejection evidence for textbook exercises.';
COMMENT ON COLUMN interactions.exercise_id IS
  'Optional durable provenance link for a manually selected verified exercise.';
