-- The Phase 1 API is the only supported access path. Keep these public-schema tables
-- inaccessible through Supabase's anon/authenticated Data API roles.
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_pages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE interactions, source_documents, source_pages FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE interactions, source_documents, source_pages FROM authenticated;
  END IF;
END
$$;
