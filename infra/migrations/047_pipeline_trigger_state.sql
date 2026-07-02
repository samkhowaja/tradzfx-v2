-- Distributed pipeline trigger checkpoint.
-- Replaces the per-process `lastProcessed` Map in pipelineTrigger.ts so that
-- multiple Next.js/server processes agree on whether a 15m bucket has already
-- been processed.

CREATE TABLE IF NOT EXISTS pipeline_trigger_state (
    symbol      TEXT PRIMARY KEY,
    bucket      BIGINT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_trigger_state_updated
    ON pipeline_trigger_state(updated_at DESC);
