CREATE TABLE source_extraction_runs (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  pipeline_version text NOT NULL,
  input_checksum text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'processing',
  error_text text,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,

  CONSTRAINT source_extraction_runs_status_valid
    CHECK (status IN ('processing', 'completed', 'failed')),
  CONSTRAINT source_extraction_runs_identity_unique
    UNIQUE (document_id, pipeline_version, input_checksum)
);

CREATE TABLE source_blocks (
  id uuid PRIMARY KEY,
  source_page_id uuid NOT NULL REFERENCES source_pages(id) ON DELETE CASCADE,
  extraction_run_id uuid NOT NULL REFERENCES source_extraction_runs(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  sequence_number integer NOT NULL,
  block_type text NOT NULL,
  bounding_box jsonb NOT NULL,
  confidence numeric(6, 5),
  review_state text NOT NULL DEFAULT 'pending',
  review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_content_markdown text NOT NULL DEFAULT '',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT source_blocks_sequence_positive CHECK (sequence_number > 0),
  CONSTRAINT source_blocks_type_valid CHECK (
    block_type IN (
      'heading', 'prose', 'formula', 'example', 'exercise', 'solution',
      'graph', 'table', 'image', 'contents', 'footer'
    )
  ),
  CONSTRAINT source_blocks_review_state_valid
    CHECK (review_state IN ('pending', 'approved', 'rejected')),
  CONSTRAINT source_blocks_confidence_valid CHECK (
    confidence IS NULL OR confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT source_blocks_bbox_valid CHECK (
    jsonb_typeof(bounding_box) = 'array'
    AND jsonb_array_length(bounding_box) = 4
    AND (bounding_box ->> 0)::numeric >= 0
    AND (bounding_box ->> 1)::numeric >= 0
    AND (bounding_box ->> 2)::numeric > 0
    AND (bounding_box ->> 3)::numeric > 0
    AND (bounding_box ->> 0)::numeric + (bounding_box ->> 2)::numeric <= 1.000001
    AND (bounding_box ->> 1)::numeric + (bounding_box ->> 3)::numeric <= 1.000001
  ),
  CONSTRAINT source_blocks_run_source_key_unique
    UNIQUE (extraction_run_id, source_key)
);

CREATE TABLE source_block_candidates (
  id uuid PRIMARY KEY,
  source_block_id uuid NOT NULL REFERENCES source_blocks(id) ON DELETE CASCADE,
  engine text NOT NULL,
  pass_name text NOT NULL,
  content_markdown text NOT NULL,
  latex text,
  confidence numeric(6, 5),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT source_block_candidates_engine_valid
    CHECK (engine IN ('apple_vision', 'pix2tex', 'manual')),
  CONSTRAINT source_block_candidates_confidence_valid CHECK (
    confidence IS NULL OR confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT source_block_candidates_identity_unique
    UNIQUE (source_block_id, engine, pass_name)
);

CREATE TABLE source_block_reviews (
  id uuid PRIMARY KEY,
  source_block_id uuid NOT NULL REFERENCES source_blocks(id) ON DELETE CASCADE,
  decision text NOT NULL,
  content_markdown text NOT NULL,
  reviewer text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT source_block_reviews_decision_valid
    CHECK (decision IN ('approve', 'correct', 'reject'))
);

CREATE INDEX source_extraction_runs_document_idx
  ON source_extraction_runs (document_id, started_at DESC);
CREATE INDEX source_blocks_page_order_idx
  ON source_blocks (source_page_id, sequence_number) WHERE deleted_at IS NULL;
CREATE INDEX source_blocks_review_state_idx
  ON source_blocks (review_state) WHERE deleted_at IS NULL;
CREATE INDEX source_block_candidates_block_idx
  ON source_block_candidates (source_block_id);
CREATE INDEX source_block_reviews_block_idx
  ON source_block_reviews (source_block_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_source_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER source_block_candidates_append_only
  BEFORE UPDATE OR DELETE ON source_block_candidates
  FOR EACH ROW EXECUTE FUNCTION prevent_source_evidence_mutation();

CREATE TRIGGER source_block_reviews_append_only
  BEFORE UPDATE OR DELETE ON source_block_reviews
  FOR EACH ROW EXECUTE FUNCTION prevent_source_evidence_mutation();

ALTER TABLE source_extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_block_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_block_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE
      source_extraction_runs, source_blocks, source_block_candidates,
      source_block_reviews FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE
      source_extraction_runs, source_blocks, source_block_candidates,
      source_block_reviews FROM authenticated;
  END IF;
END
$$;

COMMENT ON TABLE source_extraction_runs IS
  'Versioned, resumable local textbook extraction runs.';
COMMENT ON TABLE source_blocks IS
  'Ordered page regions in normalized top-left coordinates.';
COMMENT ON TABLE source_block_candidates IS
  'Immutable raw outputs from local extraction engines.';
COMMENT ON TABLE source_block_reviews IS
  'Append-only human approval and correction evidence.';
