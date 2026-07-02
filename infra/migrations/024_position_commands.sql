-- Position-level remote commands for server-to-EA actions
-- (e.g., trailing-stop updates, emergency close).

CREATE TABLE IF NOT EXISTS position_commands (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending',
                    -- pending, sent, completed, failed
    command_type    TEXT NOT NULL,
                    -- MODIFY_SL, CLOSE_POSITION, PARTIAL_CLOSE
    mt5_ticket      BIGINT,
    new_sl          DOUBLE PRECISION,
    new_tp          DOUBLE PRECISION,
    close_lots      DOUBLE PRECISION,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_position_commands_pending
    ON position_commands(status, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_position_commands_order
    ON position_commands(order_id);
