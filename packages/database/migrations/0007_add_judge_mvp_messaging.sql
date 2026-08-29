-- One-student Phase 3 judge demonstration: context reason, onboarding profile,
-- and provider-neutral delivery metadata. Message bodies stay in the existing
-- canonical interaction result rather than being copied into event records.
ALTER TABLE interactions
  ADD COLUMN mode text NOT NULL DEFAULT 'PRACTISE',
  ADD COLUMN reason text NOT NULL DEFAULT 'Manual judge MVP demonstration';

ALTER TABLE interactions
  ADD CONSTRAINT interactions_mode_valid
    CHECK (mode IN ('PREPARE', 'PRACTISE', 'REVIEW')),
  ADD CONSTRAINT interactions_reason_not_blank
    CHECK (btrim(reason) <> '');

CREATE TABLE demo_profiles (
  profile_id text PRIMARY KEY,
  course text NOT NULL,
  self_assessed_level text NOT NULL,
  previous_grade text,
  trace_id text NOT NULL,
  completed_at timestamptz NOT NULL,

  CONSTRAINT demo_profiles_single_student
    CHECK (profile_id = 'demo-student'),
  CONSTRAINT demo_profiles_course_not_blank
    CHECK (btrim(course) <> '' AND length(course) <= 80),
  CONSTRAINT demo_profiles_level_valid
    CHECK (self_assessed_level IN ('struggling', 'okay', 'confident')),
  CONSTRAINT demo_profiles_previous_grade_valid
    CHECK (previous_grade IS NULL OR (btrim(previous_grade) <> '' AND length(previous_grade) <= 20)),
  CONSTRAINT demo_profiles_trace_not_blank
    CHECK (btrim(trace_id) <> '')
);

CREATE TABLE demo_outbound_reservations (
  interaction_id text NOT NULL REFERENCES interactions(interaction_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  trace_id text NOT NULL,
  reserved_at timestamptz NOT NULL,
  PRIMARY KEY (interaction_id, idempotency_key),

  CONSTRAINT demo_outbound_reservations_key_valid
    CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 160),
  CONSTRAINT demo_outbound_reservations_trace_not_blank
    CHECK (btrim(trace_id) <> '')
);

CREATE TABLE demo_message_events (
  id uuid PRIMARY KEY,
  interaction_id text NOT NULL REFERENCES interactions(interaction_id) ON DELETE CASCADE,
  trace_id text NOT NULL,
  provider text NOT NULL,
  direction text NOT NULL,
  event_type text NOT NULL,
  provider_event_id text,
  provider_message_id text,
  idempotency_key text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,

  CONSTRAINT demo_message_events_trace_not_blank
    CHECK (btrim(trace_id) <> ''),
  CONSTRAINT demo_message_events_provider_valid
    CHECK (btrim(provider) <> '' AND length(provider) <= 40),
  CONSTRAINT demo_message_events_direction_valid
    CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT demo_message_events_type_valid
    CHECK (event_type IN ('accepted', 'received', 'failed')),
  CONSTRAINT demo_message_events_inbound_id_required
    CHECK (direction <> 'inbound' OR provider_event_id IS NOT NULL),
  CONSTRAINT demo_message_events_outbound_key_required
    CHECK (direction <> 'outbound' OR idempotency_key IS NOT NULL)
);

CREATE UNIQUE INDEX demo_message_events_provider_event_unique
  ON demo_message_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX demo_message_events_provider_message_unique
  ON demo_message_events (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX demo_message_events_outbound_event_unique
  ON demo_message_events (interaction_id, idempotency_key, event_type)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX demo_message_events_interaction_time_idx
  ON demo_message_events (interaction_id, occurred_at, recorded_at);

ALTER TABLE demo_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_outbound_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_message_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE
      demo_profiles, demo_outbound_reservations, demo_message_events FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE
      demo_profiles, demo_outbound_reservations, demo_message_events FROM authenticated;
  END IF;
END
$$;

COMMENT ON TABLE demo_profiles IS
  'Single synthetic profile used only by the judge-facing iMessage demonstration.';
COMMENT ON TABLE demo_outbound_reservations IS
  'At-most-once outbound reservations made before invoking a messaging provider.';
COMMENT ON TABLE demo_message_events IS
  'Normalized message delivery metadata without message bodies or credentials.';
