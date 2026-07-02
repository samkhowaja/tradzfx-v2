-- Add equity column to mt5_terminals so the heartbeat endpoint can persist equity snapshots.
ALTER TABLE mt5_terminals ADD COLUMN IF NOT EXISTS equity double precision;
