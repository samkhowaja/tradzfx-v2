-- Migration 185: prevent duplicate candidate windows from repeated discovery runs.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trusted_windows_candidate_identity
    ON market.trusted_windows(symbol, timeframe, window_start, window_end, detector_version)
    WHERE status = 'candidate';

COMMIT;
