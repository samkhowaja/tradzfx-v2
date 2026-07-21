-- Phase 3: side-effect-free signal replay audit.
-- Replay results never enter live_signal, live_order, orders, or position_commands.

CREATE TABLE IF NOT EXISTS signal_replay_run (
    run_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id            TEXT NOT NULL,
    symbol                TEXT NOT NULL,
    start_ts              TIMESTAMPTZ NOT NULL,
    end_ts                TIMESTAMPTZ NOT NULL,
    spec_hash             TEXT NOT NULL,
    code_version          TEXT,
    mode                  TEXT NOT NULL DEFAULT 'read_only'
                          CHECK (mode IN ('read_only', 'persist_audit')),
    anchors_evaluated     INTEGER NOT NULL DEFAULT 0,
    matches               INTEGER NOT NULL DEFAULT 0,
    mismatches            INTEGER NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,
    summary_json          JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_signal_replay_run_variant
  ON signal_replay_run(variant_id, symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS signal_replay_result (
    result_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                 UUID NOT NULL REFERENCES signal_replay_run(run_id) ON DELETE CASCADE,
    symbol                 TEXT NOT NULL,
    evaluation_ts          TIMESTAMPTZ NOT NULL,
    strategy_id            TEXT NOT NULL,
    replay_signal_ts       TIMESTAMPTZ,
    live_signal_id         UUID REFERENCES live_signal(signal_id),
    replay_fingerprint     TEXT,
    live_fingerprint       TEXT,
    signal_match           BOOLEAN NOT NULL,
    geometry_match         BOOLEAN NOT NULL,
    decision_match         BOOLEAN NOT NULL DEFAULT FALSE,
    replay_executed        BOOLEAN,
    live_executed          BOOLEAN,
    replay_reason          TEXT,
    live_reason            TEXT,
    mismatch_class         TEXT NOT NULL CHECK (mismatch_class IN (
                              'MATCH', 'LIVE_ONLY', 'REPLAY_ONLY',
                              'SIGNAL_GEOMETRY', 'MISSING_PROVENANCE',
                              'LIVE_ONLY_EXECUTION', 'REPLAY_ONLY_EXECUTION',
                              'DECISION_STAGE', 'DECISION_REASON'
                            )),
    differences            JSONB NOT NULL DEFAULT '[]',
    replay_json            JSONB,
    live_json              JSONB,
    replay_decision_json   JSONB,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, symbol, evaluation_ts, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_replay_result_mismatch
  ON signal_replay_result(run_id, mismatch_class, evaluation_ts);
