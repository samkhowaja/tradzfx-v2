-- Migration 005b: Session high/low tracker
-- Stores Asian, London, NY, and Globex session H/L per trading day.
-- Used by: ForexStrategy ORB, Bernd Globex, ICT Turtle Soup, Tomtrades CBR, Waqar

CREATE TABLE IF NOT EXISTS features_session_hl (
  symbol     TEXT        NOT NULL,
  date       DATE        NOT NULL,
  session    TEXT        NOT NULL,  -- 'asian', 'london', 'ny', 'globex', 'overlap'
  high       DOUBLE PRECISION NOT NULL,
  low        DOUBLE PRECISION NOT NULL,
  open       DOUBLE PRECISION NOT NULL,
  close      DOUBLE PRECISION NOT NULL,
  engine_ver TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash TEXT        NOT NULL,
  PRIMARY KEY (symbol, date, session)
);

CREATE INDEX IF NOT EXISTS idx_features_session_hl_date
  ON features_session_hl(symbol, date DESC);

CREATE INDEX IF NOT EXISTS idx_features_session_hl_session
  ON features_session_hl(session, symbol, date DESC);
