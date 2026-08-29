-- Preserve when the first Phase 1 result was accepted.
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Existing completed rows predate this column; retain them with the best available timestamp.
UPDATE interactions
SET completed_at = created_at
WHERE result IS NOT NULL AND completed_at IS NULL;

ALTER TABLE interactions
  DROP CONSTRAINT IF EXISTS interactions_completion_is_all_or_nothing;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_completion_is_all_or_nothing
  CHECK (
    (
      question IS NULL
      AND student_reply IS NULL
      AND feedback IS NULL
      AND result IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      question IS NOT NULL
      AND student_reply IS NOT NULL
      AND feedback IS NOT NULL
      AND result IS NOT NULL
      AND completed_at IS NOT NULL
    )
  );
