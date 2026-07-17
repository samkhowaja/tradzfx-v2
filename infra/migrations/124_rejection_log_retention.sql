-- live_signal_rejection retention documented.
--
-- Runtime cleanup is handled by scripts/cleanup-rejection-log-cron.js (PM2:
-- tz-cleanup-rejection-log). It DELETE rows older than 7 days on a 1h interval.
-- No DDL changes needed — this migration exists solely to document the policy.
--
-- See: ecosystem.config.js, scripts/cleanup-rejection-log-cron.js
SELECT 1;
