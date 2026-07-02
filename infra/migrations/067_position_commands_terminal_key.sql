-- Link each position command to the terminal that owns the order.
-- This lets each MT4/MT5 EA poll only the commands it can actually execute.
ALTER TABLE position_commands
  ADD COLUMN IF NOT EXISTS terminal_key_id UUID;

CREATE INDEX IF NOT EXISTS idx_position_commands_terminal_status
  ON position_commands (terminal_key_id, status);
