-- Migration 163: durable progressive DAG setup lifecycle.
--
-- Shadow-only foundation. No live-order path reads these tables yet.
-- Event inbox is immutable/idempotent; setup_instance is authoritative current
-- state; setup_node is query projection; setup_transition is immutable audit.

BEGIN;

CREATE TABLE IF NOT EXISTS progressive_plan_registry (
  plan_hash TEXT PRIMARY KEY CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  strategy_id TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  plan_json JSONB NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS progressive_setup_instance (
  setup_instance_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  plan_hash TEXT NOT NULL REFERENCES progressive_plan_registry(plan_hash),
  symbol TEXT NOT NULL,
  side TEXT CHECK (side IS NULL OR side IN ('buy', 'sell')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'entry_ready', 'entered', 'invalidated', 'expired')),
  terminal_node_id TEXT,
  state_json JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  entered_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  CHECK ((status = 'entered') = (entered_at IS NOT NULL)),
  CHECK ((status = 'invalidated') = (invalidated_at IS NOT NULL)),
  CHECK ((status = 'expired') = (expired_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_progressive_setup_instance_active
  ON progressive_setup_instance(strategy_id, symbol, updated_at DESC)
  WHERE status IN ('active', 'entry_ready');

CREATE TABLE IF NOT EXISTS progressive_setup_event_inbox (
  event_id TEXT PRIMARY KEY,
  setup_instance_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  symbol TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('evidence', 'invalidate', 'expire', 'execution_accepted')),
  node_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'applied', 'ignored', 'error')),
  ignored_reason TEXT,
  transition_fingerprint TEXT,
  error_text TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token TEXT,
  claimed_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  FOREIGN KEY (setup_instance_id) REFERENCES progressive_setup_instance(setup_instance_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK ((processing_status = 'pending') = (processed_at IS NULL)),
  CHECK ((claim_token IS NULL) = (claimed_at IS NULL)),
  CHECK ((claim_token IS NULL) = (claim_expires_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_progressive_setup_event_pending
  ON progressive_setup_event_inbox(occurred_at, event_id)
  WHERE processing_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_progressive_setup_event_instance
  ON progressive_setup_event_inbox(setup_instance_id, occurred_at, event_id);

CREATE TABLE IF NOT EXISTS progressive_setup_node (
  setup_instance_id TEXT NOT NULL REFERENCES progressive_setup_instance(setup_instance_id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  consumption_policy TEXT NOT NULL
    CHECK (consumption_policy IN ('exclusive_setup', 'shared_root', 'reusable')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'satisfied', 'invalidated', 'expired')),
  evidence_json JSONB,
  evidence_hash TEXT,
  source_feature TEXT,
  source_symbol TEXT,
  source_tf TEXT,
  source_ts TIMESTAMPTZ,
  source_key TEXT,
  occurred_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (setup_instance_id, node_id),
  CHECK ((status = 'satisfied') = (evidence_json IS NOT NULL)),
  CHECK ((evidence_json IS NULL) = (evidence_hash IS NULL)),
  CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_progressive_setup_node_source
  ON progressive_setup_node(source_feature, source_symbol, source_tf, source_ts, source_key)
  WHERE status = 'satisfied' AND source_feature IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_progressive_setup_node_exclusive_evidence
  ON progressive_setup_node(source_feature, source_symbol, source_tf, source_ts, source_key)
  WHERE status = 'satisfied'
    AND consumption_policy = 'exclusive_setup'
    AND source_feature IS NOT NULL;

CREATE TABLE IF NOT EXISTS progressive_setup_transition (
  transition_id BIGSERIAL PRIMARY KEY,
  setup_instance_id TEXT NOT NULL REFERENCES progressive_setup_instance(setup_instance_id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_id TEXT NOT NULL REFERENCES progressive_setup_event_inbox(event_id),
  occurred_at TIMESTAMPTZ NOT NULL,
  node_id TEXT,
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_hash TEXT,
  transition_fingerprint TEXT NOT NULL UNIQUE CHECK (transition_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (setup_instance_id, sequence),
  UNIQUE (setup_instance_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_progressive_setup_transition_timeline
  ON progressive_setup_transition(setup_instance_id, sequence);

COMMIT;
