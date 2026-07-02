-- Add optional close reason to position-level commands
-- so the EA can tag emergency closes (e.g. bad fill protection).

ALTER TABLE position_commands
    ADD COLUMN IF NOT EXISTS close_reason TEXT;
