-- Durable, single-student Sendblue inbox/outbox for the hosted Phase 3 loop.
ALTER TABLE demo_message_events
  DROP CONSTRAINT demo_message_events_type_valid;

ALTER TABLE demo_message_events
  ADD CONSTRAINT demo_message_events_type_valid
    CHECK (event_type IN ('accepted', 'sent', 'delivered', 'received', 'failed'));

DROP INDEX demo_message_events_provider_message_unique;

CREATE INDEX demo_message_events_provider_message_idx
  ON demo_message_events (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE demo_messaging_sessions (
  interaction_id text PRIMARY KEY REFERENCES interactions(interaction_id) ON DELETE CASCADE,
  provider text NOT NULL,
  participant_address text NOT NULL,
  provider_line text NOT NULL,
  status text NOT NULL,
  turn_number integer NOT NULL DEFAULT 0,
  agent_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_prompt_at timestamptz,
  trace_id text NOT NULL,
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT demo_messaging_sessions_provider_valid
    CHECK (btrim(provider) <> '' AND length(provider) <= 40),
  CONSTRAINT demo_messaging_sessions_participant_valid
    CHECK (btrim(participant_address) <> '' AND length(participant_address) <= 80),
  CONSTRAINT demo_messaging_sessions_line_valid
    CHECK (btrim(provider_line) <> '' AND length(provider_line) <= 80),
  CONSTRAINT demo_messaging_sessions_status_valid
    CHECK (status IN ('active', 'completed', 'stopped', 'failed')),
  CONSTRAINT demo_messaging_sessions_turn_valid
    CHECK (turn_number >= 0),
  CONSTRAINT demo_messaging_sessions_trace_valid
    CHECK (btrim(trace_id) <> ''),
  CONSTRAINT demo_messaging_sessions_failure_consistent
    CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

CREATE UNIQUE INDEX demo_messaging_sessions_active_participant_unique
  ON demo_messaging_sessions (provider, participant_address, provider_line)
  WHERE status = 'active';

CREATE TABLE demo_inbound_messages (
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  provider_message_id text NOT NULL,
  interaction_id text NOT NULL REFERENCES demo_messaging_sessions(interaction_id) ON DELETE CASCADE,
  turn_number integer NOT NULL,
  sender_address text NOT NULL,
  content text NOT NULL,
  received_at timestamptz NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  error_code text,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  processed_at timestamptz,
  PRIMARY KEY (provider, provider_event_id),

  CONSTRAINT demo_inbound_messages_provider_valid
    CHECK (btrim(provider) <> '' AND length(provider) <= 40),
  CONSTRAINT demo_inbound_messages_event_valid
    CHECK (btrim(provider_event_id) <> '' AND length(provider_event_id) <= 200),
  CONSTRAINT demo_inbound_messages_message_valid
    CHECK (btrim(provider_message_id) <> '' AND length(provider_message_id) <= 200),
  CONSTRAINT demo_inbound_messages_turn_valid
    CHECK (turn_number >= 0),
  CONSTRAINT demo_inbound_messages_sender_valid
    CHECK (btrim(sender_address) <> '' AND length(sender_address) <= 80),
  CONSTRAINT demo_inbound_messages_content_valid
    CHECK (btrim(content) <> '' AND length(content) <= 18996),
  CONSTRAINT demo_inbound_messages_status_valid
    CHECK (processing_status IN ('pending', 'processing', 'processed', 'failed')),
  CONSTRAINT demo_inbound_messages_attempt_valid
    CHECK (attempt_count >= 0),
  CONSTRAINT demo_inbound_messages_trace_valid
    CHECK (btrim(trace_id) <> '')
);

CREATE INDEX demo_inbound_messages_claim_idx
  ON demo_inbound_messages (processing_status, updated_at, received_at)
  WHERE processing_status IN ('pending', 'processing');

CREATE TABLE demo_outbound_outbox (
  interaction_id text NOT NULL REFERENCES demo_messaging_sessions(interaction_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  turn_number integer NOT NULL,
  purpose text NOT NULL,
  content text,
  media_url text,
  delivery_status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  provider_message_id text,
  accepted_at timestamptz,
  failure_code text,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (interaction_id, idempotency_key),

  CONSTRAINT demo_outbound_outbox_key_valid
    CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 160),
  CONSTRAINT demo_outbound_outbox_turn_valid
    CHECK (turn_number >= 0),
  CONSTRAINT demo_outbound_outbox_purpose_valid
    CHECK (btrim(purpose) <> '' AND length(purpose) <= 80),
  CONSTRAINT demo_outbound_outbox_content_valid
    CHECK (content IS NULL OR (btrim(content) <> '' AND length(content) <= 18996)),
  CONSTRAINT demo_outbound_outbox_media_valid
    CHECK (media_url IS NULL OR (media_url ~ '^https://' AND length(media_url) <= 2048)),
  CONSTRAINT demo_outbound_outbox_provider_message_valid
    CHECK (provider_message_id IS NULL OR (btrim(provider_message_id) <> '' AND length(provider_message_id) <= 200)),
  CONSTRAINT demo_outbound_outbox_payload_required
    CHECK (content IS NOT NULL OR media_url IS NOT NULL),
  CONSTRAINT demo_outbound_outbox_status_valid
    CHECK (delivery_status IN ('pending', 'processing', 'accepted', 'sent', 'delivered', 'failed', 'uncertain', 'suppressed')),
  CONSTRAINT demo_outbound_outbox_attempt_valid
    CHECK (attempt_count >= 0),
  CONSTRAINT demo_outbound_outbox_trace_valid
    CHECK (btrim(trace_id) <> '')
);

CREATE INDEX demo_outbound_outbox_claim_idx
  ON demo_outbound_outbox (delivery_status, updated_at, created_at)
  WHERE delivery_status IN ('pending', 'processing');

CREATE UNIQUE INDEX demo_outbound_outbox_provider_message_idx
  ON demo_outbound_outbox (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE demo_messaging_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_outbound_outbox ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE
      demo_messaging_sessions, demo_inbound_messages, demo_outbound_outbox FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE
      demo_messaging_sessions, demo_inbound_messages, demo_outbound_outbox FROM authenticated;
  END IF;
END
$$;

COMMENT ON TABLE demo_messaging_sessions IS
  'Durable provider-neutral session state for one hosted messaging interaction.';
COMMENT ON TABLE demo_inbound_messages IS
  'Minimized inbound message evidence retained until the pilot retention policy is finalized.';
COMMENT ON TABLE demo_outbound_outbox IS
  'Durable at-most-once outbound intents. Uncertain deliveries are never automatically retried.';
