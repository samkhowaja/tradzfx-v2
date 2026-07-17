-- features_session primary key was missing the timeframe column, so only one
-- session row could exist per (symbol, ts) across all timeframes. This caused
-- daily session rows to conflict with intraday rows and silently disappear
-- during backfills.
ALTER TABLE features_session
  DROP CONSTRAINT features_session_pkey,
  ADD PRIMARY KEY (symbol, ts, tf);
