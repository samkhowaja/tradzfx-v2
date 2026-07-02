-- Idempotent position-command lifecycle
-- 1) Monotonic sequence number so the EA can ack its last processed command.
-- 2) TTL so stale pending commands cannot execute hours later.
-- 3) Status check constraint to prevent invalid transitions at the DB level.

ALTER TABLE position_commands
  ADD COLUMN IF NOT EXISTS sequence_number BIGINT GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Default TTL: 30 minutes from creation for any pending/sent command.
UPDATE position_commands
  SET expires_at = created_at + INTERVAL '30 minutes'
  WHERE expires_at IS NULL;

ALTER TABLE position_commands
  ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '30 minutes';

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_commands_sequence_number
  ON position_commands(sequence_number);

CREATE INDEX IF NOT EXISTS idx_position_commands_pending_seq
  ON position_commands(status, sequence_number)
  WHERE status = 'pending';
