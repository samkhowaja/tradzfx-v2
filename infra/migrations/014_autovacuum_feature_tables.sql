-- Migration 010: Autovacuum tuning for high-churn V2 feature tables
--
-- Context:
--   features_atr had severe bloat (~3.2M dead tuples vs ~8K live) because
--   long-running stuck backends blocked autovacuum. After manual VACUUM
--   (ANALYZE) and backend termination, query performance was restored.
--   This migration makes autovacuum more aggressive on feature tables so
--   dead tuples are reclaimed before they accumulate again.
--
-- Idempotent: ALTER TABLE ... SET can be re-run safely.

-- Most aggressive settings for ATR: one row per symbol/tf/period per candle.
ALTER TABLE features_atr SET (
  autovacuum_vacuum_scale_factor    = 0.02,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.05,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.01,
  autovacuum_analyze_threshold      = 500
);

-- Moderately aggressive settings for the rest of the feature tables.
-- These tables are insert-heavy and benefit from frequent vacuums/analyzes
-- to keep plan statistics fresh and visibility maps up to date.
ALTER TABLE features_moving_average SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_bollinger SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_keltner SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_ifvg SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_zone SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_displacement SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_candle_pattern SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_opening_range SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_indicator SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_bias SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_pricing SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);

ALTER TABLE features_structure SET (
  autovacuum_vacuum_scale_factor    = 0.05,
  autovacuum_vacuum_threshold       = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.10,
  autovacuum_vacuum_insert_threshold    = 1000,
  autovacuum_analyze_scale_factor   = 0.02,
  autovacuum_analyze_threshold      = 500
);
