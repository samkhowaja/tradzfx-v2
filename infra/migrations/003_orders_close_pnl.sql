-- Migration 003: Add realized_pnl to orders table for position close tracking

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS realized_pnl DOUBLE PRECISION;
