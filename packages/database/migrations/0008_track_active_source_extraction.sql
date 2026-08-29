ALTER TABLE source_pages
  ADD COLUMN active_extraction_run_id uuid
  REFERENCES source_extraction_runs(id) ON DELETE SET NULL;

CREATE INDEX source_pages_active_extraction_run_idx
  ON source_pages (active_extraction_run_id)
  WHERE active_extraction_run_id IS NOT NULL;

COMMENT ON COLUMN source_pages.active_extraction_run_id IS
  'Extraction run currently exposed for review; older runs and candidates remain immutable evidence.';
