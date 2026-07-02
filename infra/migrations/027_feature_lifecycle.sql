-- Lifecycle tracking for analyzer events.
-- Adds mitigated_at / invalidated_at columns so the analyzer knows when an event ends.

ALTER TABLE features_zone
  ADD COLUMN IF NOT EXISTS mitigated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

ALTER TABLE features_ifvg
  ADD COLUMN IF NOT EXISTS mitigated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

ALTER TABLE features_sweep
  ADD COLUMN IF NOT EXISTS mitigated_at TIMESTAMPTZ;

ALTER TABLE features_structure
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_features_zone_lifecycle
  ON features_zone(symbol, tf, mitigated_at, invalidated_at);
CREATE INDEX IF NOT EXISTS idx_features_ifvg_lifecycle
  ON features_ifvg(symbol, tf, mitigated_at, invalidated_at);
CREATE INDEX IF NOT EXISTS idx_features_sweep_lifecycle
  ON features_sweep(symbol, tf, mitigated_at);
CREATE INDEX IF NOT EXISTS idx_features_structure_lifecycle
  ON features_structure(symbol, tf, invalidated_at);
