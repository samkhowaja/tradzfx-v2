-- Canonical market levels table.
-- Aggregates zones, order blocks, liquidity pools, pivots, fair-value gaps,
-- and equal highs/lows into a single typed store consumed by both the live
-- trading pipeline and the analyzer replay kernel.

CREATE TABLE IF NOT EXISTS market_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_hash TEXT NOT NULL UNIQUE, -- deterministic id for dedup: sha256(symbol,tf,type,kind,top,bottom,ts)
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  level_type TEXT NOT NULL,        -- zone, order_block, liquidity_pool, pivot, fvg, eq_liquidity
  kind TEXT NOT NULL,              -- demand | supply | high | low | buyside | sellside | bullish | bearish
  top NUMERIC NOT NULL,
  bottom NUMERIC NOT NULL,
  strength NUMERIC,                -- quality / freshness score (0..1 or unbounded)
  invalidated_at TIMESTAMPTZ,
  tapped_at TIMESTAMPTZ,
  touch_count INT NOT NULL DEFAULT 0,
  source_id TEXT,                  -- e.g. original feature row id for traceability
  source_json JSONB,
  ts TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_levels_lookup
  ON market_levels (symbol, level_type, kind, ts DESC)
  WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_market_levels_symbol_ts
  ON market_levels (symbol, ts DESC);

CREATE INDEX IF NOT EXISTS idx_market_levels_type_ts
  ON market_levels (level_type, ts DESC);
