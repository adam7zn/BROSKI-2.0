CREATE TABLE source_documents (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  title text NOT NULL,
  storage_key text NOT NULL,
  checksum text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  license_note text,
  import_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT source_documents_kind_valid
    CHECK (kind IN ('textbook', 'answer_key', 'teacher_file')),
  CONSTRAINT source_documents_version_positive CHECK (version > 0),
  CONSTRAINT source_documents_import_status_valid
    CHECK (import_status IN ('pending', 'processing', 'reviewed', 'failed')),
  CONSTRAINT source_documents_checksum_version_unique UNIQUE (checksum, version)
);

CREATE TABLE source_pages (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  file_page_number integer NOT NULL,
  printed_page_number text,
  extracted_text text,
  page_image_key text,
  extraction_confidence numeric(6, 5),
  verified_at timestamptz,
  extraction_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT source_pages_file_page_positive CHECK (file_page_number > 0),
  CONSTRAINT source_pages_confidence_valid CHECK (
    extraction_confidence IS NULL
    OR extraction_confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT source_pages_document_file_page_unique
    UNIQUE (document_id, file_page_number)
);

CREATE INDEX source_pages_printed_page_idx
  ON source_pages (document_id, printed_page_number);

COMMENT ON TABLE source_documents IS
  'Private imported course materials with immutable source identity.';

COMMENT ON TABLE source_pages IS
  'Page-level OCR with source provenance and explicit verification state.';
