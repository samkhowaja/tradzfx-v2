-- Migration 028: Add explicit buy/sell side to structural liquidity pools.
ALTER TABLE features_liquidity_pools ADD COLUMN IF NOT EXISTS side TEXT;
