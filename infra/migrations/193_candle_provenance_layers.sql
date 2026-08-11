-- Migration 193: dedicated immutable candle provenance layers.
-- Additive-only. Does not alter market.candle_producer_lineage.
-- No historical rows are inferred or backfilled by this migration.
BEGIN;

CREATE SCHEMA IF NOT EXISTS market;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Hash framing is declared before any authority hash function that calls it.
-- Re-declared later with CREATE OR REPLACE so the canonical helper section
-- remains grouped with the remaining provenance hash functions.
CREATE OR REPLACE FUNCTION market.provenance_field(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT length(convert_to(p_value, 'UTF8'))::text || ':' || p_value
$$;

CREATE OR REPLACE FUNCTION market.provenance_nullable_field(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_value IS NULL THEN '-:' ELSE market.provenance_field(p_value) END
$$;

CREATE TABLE IF NOT EXISTS market.candle_calendar_policy (
  calendar_version TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  timezone TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  weekend_close_dow SMALLINT NOT NULL CHECK (weekend_close_dow BETWEEN 0 AND 6),
  weekend_close_hour SMALLINT NOT NULL CHECK (weekend_close_hour BETWEEN 0 AND 23),
  weekend_reopen_dow SMALLINT NOT NULL CHECK (weekend_reopen_dow BETWEEN 0 AND 6),
  weekend_reopen_hour SMALLINT NOT NULL CHECK (weekend_reopen_hour BETWEEN 0 AND 23),
  daily_break_start_hour SMALLINT NOT NULL CHECK (daily_break_start_hour BETWEEN 0 AND 23),
  daily_break_minutes SMALLINT NOT NULL CHECK (daily_break_minutes BETWEEN 0 AND 1440),
  policy_sha256 TEXT NOT NULL CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (policy_id, effective_from)
);

CREATE OR REPLACE FUNCTION market.calendar_policy_hash(
  p_policy_id TEXT, p_calendar_version TEXT, p_timezone TEXT,
  p_effective_from TIMESTAMPTZ, p_effective_to TIMESTAMPTZ,
  p_weekend_close_dow SMALLINT, p_weekend_close_hour SMALLINT,
  p_weekend_reopen_dow SMALLINT, p_weekend_reopen_hour SMALLINT,
  p_daily_break_start_hour SMALLINT, p_daily_break_minutes SMALLINT
) RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(digest(
    'calendar-v1|' || market.provenance_field(p_policy_id) ||
    market.provenance_field(p_calendar_version) || market.provenance_field(p_timezone) ||
    market.provenance_field(to_char(p_effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ||
    market.provenance_nullable_field(CASE WHEN p_effective_to IS NULL THEN NULL ELSE to_char(p_effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ||
    market.provenance_field(p_weekend_close_dow::text) || market.provenance_field(p_weekend_close_hour::text) ||
    market.provenance_field(p_weekend_reopen_dow::text) || market.provenance_field(p_weekend_reopen_hour::text) ||
    market.provenance_field(p_daily_break_start_hour::text) || market.provenance_field(p_daily_break_minutes::text),
    'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION market.validate_calendar_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.policy_sha256 <> market.calendar_policy_hash(
    NEW.policy_id, NEW.calendar_version, NEW.timezone, NEW.effective_from, NEW.effective_to,
    NEW.weekend_close_dow, NEW.weekend_close_hour, NEW.weekend_reopen_dow,
    NEW.weekend_reopen_hour, NEW.daily_break_start_hour, NEW.daily_break_minutes) THEN
    RAISE EXCEPTION 'calendar policy hash mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION market.reject_authority_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '% is append-only: authority mutation rejected', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_calendar_policy ON market.candle_calendar_policy;
CREATE OR REPLACE TRIGGER trg_validate_calendar_policy
BEFORE INSERT ON market.candle_calendar_policy
FOR EACH ROW EXECUTE FUNCTION market.validate_calendar_policy();

DROP TRIGGER IF EXISTS trg_calendar_policy_append_only ON market.candle_calendar_policy;
CREATE OR REPLACE TRIGGER trg_calendar_policy_append_only
BEFORE UPDATE OR DELETE ON market.candle_calendar_policy
FOR EACH ROW EXECUTE FUNCTION market.reject_authority_mutation();

-- Certification authority is append-only and versioned.  Caller claims are
-- intentionally absent from these tables: only rows committed here can admit
-- provenance.
CREATE TABLE IF NOT EXISTS market.candle_authority_snapshot (
  authority_snapshot_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol TEXT NOT NULL,
  broker TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  quarantine_version TEXT NOT NULL,
  calendar_version TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  broker_allowed BOOLEAN NOT NULL,
  quarantine_state TEXT NOT NULL CHECK (quarantine_state IN ('NONE','BLOCKED','RELEASED')),
  calendar_rule TEXT NOT NULL,
  authority_sha256 TEXT NOT NULL CHECK (authority_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (symbol, broker, policy_version, quarantine_version, calendar_version, effective_from)
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'market.candle_authority_snapshot'::regclass
      AND conname = 'candle_authority_calendar_fk'
  ) THEN
    ALTER TABLE market.candle_authority_snapshot
      ADD CONSTRAINT candle_authority_calendar_fk
      FOREIGN KEY (calendar_version) REFERENCES market.candle_calendar_policy(calendar_version);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION market.candle_authority_hash(
  p_symbol TEXT, p_broker TEXT, p_policy_version TEXT,
  p_quarantine_version TEXT, p_calendar_version TEXT,
  p_effective_from TIMESTAMPTZ, p_effective_to TIMESTAMPTZ,
  p_broker_allowed BOOLEAN, p_quarantine_state TEXT, p_calendar_rule TEXT,
  p_calendar_policy_sha256 TEXT
) RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(digest(
    'authority-v1|' ||
    market.provenance_field(p_symbol) || market.provenance_field(p_broker) ||
    market.provenance_field(p_policy_version) || market.provenance_field(p_quarantine_version) ||
    market.provenance_field(p_calendar_version) ||
    market.provenance_field(to_char(p_effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ||
    market.provenance_nullable_field(CASE WHEN p_effective_to IS NULL THEN NULL ELSE to_char(p_effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ||
    market.provenance_field(p_broker_allowed::text) || market.provenance_field(p_quarantine_state) ||
    market.provenance_field(p_calendar_rule) ||
    market.provenance_field(p_calendar_policy_sha256), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION market.resolve_candle_authority(
  p_symbol TEXT, p_broker TEXT, p_candle_ts TIMESTAMPTZ
) RETURNS BIGINT LANGUAGE plpgsql STABLE AS $$
DECLARE v_id BIGINT;
BEGIN
  SELECT authority_snapshot_id INTO STRICT v_id
  FROM market.candle_authority_snapshot
  WHERE symbol = p_symbol AND broker = p_broker
    AND effective_from <= p_candle_ts
    AND (effective_to IS NULL OR p_candle_ts < effective_to)
    AND broker_allowed
    AND quarantine_state IN ('NONE','RELEASED');
  RETURN v_id;
EXCEPTION WHEN NO_DATA_FOUND THEN
  RAISE EXCEPTION 'no admissible authority snapshot for %/% at %', p_symbol, p_broker, p_candle_ts;
       WHEN TOO_MANY_ROWS THEN
  RAISE EXCEPTION 'multiple admissible authority snapshots for %/% at %', p_symbol, p_broker, p_candle_ts;
END;
$$;

CREATE OR REPLACE FUNCTION market.validate_candle_authority_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.authority_sha256 <> market.candle_authority_hash(
    NEW.symbol, NEW.broker, NEW.policy_version, NEW.quarantine_version,
    NEW.calendar_version, NEW.effective_from, NEW.effective_to,
    NEW.broker_allowed, NEW.quarantine_state, NEW.calendar_rule,
    (SELECT policy_sha256 FROM market.candle_calendar_policy
     WHERE calendar_version = NEW.calendar_version)) THEN
    RAISE EXCEPTION 'authority snapshot hash mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM market.candle_calendar_policy cp
    WHERE cp.calendar_version = NEW.calendar_version
      AND NEW.effective_from >= cp.effective_from
      AND (cp.effective_to IS NULL OR NEW.effective_from < cp.effective_to)
  ) THEN
    RAISE EXCEPTION 'authority snapshot lacks effective calendar policy';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_candle_authority_snapshot ON market.candle_authority_snapshot;
CREATE OR REPLACE TRIGGER trg_validate_candle_authority_snapshot
BEFORE INSERT ON market.candle_authority_snapshot
FOR EACH ROW EXECUTE FUNCTION market.validate_candle_authority_snapshot();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'market.candle_authority_snapshot'::regclass
      AND conname = 'candle_authority_snapshot_nonoverlap'
  ) THEN
    ALTER TABLE market.candle_authority_snapshot
      ADD CONSTRAINT candle_authority_snapshot_nonoverlap
      EXCLUDE USING gist
      (symbol WITH =, broker WITH =,
       tstzrange(effective_from, effective_to, '[)') WITH &&);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_candle_authority_lookup
  ON market.candle_authority_snapshot(symbol, broker, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS market.xauusd_expected_minute (
  expected_set_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  interval_start TIMESTAMPTZ NOT NULL,
  interval_end TIMESTAMPTZ NOT NULL,
  minute_ts TIMESTAMPTZ NOT NULL,
  calendar_version TEXT NOT NULL,
  tradable BOOLEAN NOT NULL,
  set_sha256 TEXT NOT NULL CHECK (set_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (minute_ts = date_trunc('minute', minute_ts)),
  CHECK (interval_end > interval_start),
  CHECK (minute_ts >= interval_start AND minute_ts < interval_end),
  UNIQUE (interval_start, interval_end, minute_ts, calendar_version)
);

CREATE TABLE IF NOT EXISTS market.candle_quarantine_evidence (
  quarantine_evidence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol TEXT NOT NULL,
  broker TEXT NOT NULL,
  candle_ts TIMESTAMPTZ NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe = '1m'),
  source_key TEXT NOT NULL,
  anomaly_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity TEXT NOT NULL,
  detector_version TEXT NOT NULL,
  detector_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision TEXT NOT NULL,
  approval_identity TEXT,
  approval_ts TIMESTAMPTZ,
  disposition TEXT NOT NULL CHECK (disposition IN ('APPROVED','BLOCKED','UNRESOLVED')),
  policy_version TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  supersedes_quarantine_evidence_id BIGINT REFERENCES market.candle_quarantine_evidence(quarantine_evidence_id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, broker, candle_ts, policy_version, evidence_sha256)
);

CREATE OR REPLACE FUNCTION market.quarantine_evidence_hash(
  p_symbol TEXT, p_broker TEXT, p_timeframe TEXT, p_candle_ts TIMESTAMPTZ,
  p_source_key TEXT, p_anomaly_flags JSONB, p_severity TEXT,
  p_detector_version TEXT, p_detector_parameters JSONB, p_decision TEXT,
  p_approval_identity TEXT, p_approval_ts TIMESTAMPTZ,
  p_supersedes BIGINT, p_active BOOLEAN
) RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(digest(
    'quarantine-v1|' || market.provenance_field(p_symbol) || market.provenance_field(p_broker) ||
    market.provenance_field(p_timeframe) || market.provenance_field(to_char(p_candle_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ||
    market.provenance_field(p_source_key) || market.provenance_field(p_anomaly_flags::text) ||
    market.provenance_field(p_severity) || market.provenance_field(p_detector_version) ||
    market.provenance_field(p_detector_parameters::text) || market.provenance_field(p_decision) ||
    market.provenance_nullable_field(p_approval_identity) || market.provenance_nullable_field(CASE WHEN p_approval_ts IS NULL THEN NULL ELSE to_char(p_approval_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ||
    market.provenance_nullable_field(p_supersedes::text) || market.provenance_field(p_active::text), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION market.validate_quarantine_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent RECORD;
BEGIN
  IF NEW.supersedes_quarantine_evidence_id IS NOT NULL THEN
    SELECT * INTO STRICT parent
    FROM market.candle_quarantine_evidence
    WHERE quarantine_evidence_id = NEW.supersedes_quarantine_evidence_id
    FOR KEY SHARE;
    IF (parent.symbol, parent.broker, parent.timeframe, parent.candle_ts, parent.source_key)
       IS DISTINCT FROM (NEW.symbol, NEW.broker, NEW.timeframe, NEW.candle_ts, NEW.source_key) THEN
      RAISE EXCEPTION 'quarantine supersession changes source identity';
    END IF;
    IF NEW.quarantine_evidence_id = NEW.supersedes_quarantine_evidence_id THEN
      RAISE EXCEPTION 'quarantine evidence cannot supersede itself';
    END IF;
    IF EXISTS (
      WITH RECURSIVE chain(quarantine_evidence_id) AS (
        SELECT NEW.supersedes_quarantine_evidence_id
        UNION ALL
        SELECT q.supersedes_quarantine_evidence_id
        FROM market.candle_quarantine_evidence q
        JOIN chain c ON q.quarantine_evidence_id = c.quarantine_evidence_id
        WHERE q.supersedes_quarantine_evidence_id IS NOT NULL
      )
      SELECT 1 FROM chain WHERE quarantine_evidence_id = NEW.quarantine_evidence_id
    ) THEN
      RAISE EXCEPTION 'quarantine supersession cycle detected';
    END IF;
  END IF;
  IF NEW.evidence_sha256 <> market.quarantine_evidence_hash(
    NEW.symbol, NEW.broker, NEW.timeframe, NEW.candle_ts, NEW.source_key,
    NEW.anomaly_flags, NEW.severity, NEW.detector_version, NEW.detector_parameters,
    NEW.decision, NEW.approval_identity, NEW.approval_ts,
    NEW.supersedes_quarantine_evidence_id, true) THEN
    RAISE EXCEPTION 'quarantine evidence hash mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_quarantine_evidence ON market.candle_quarantine_evidence;
CREATE OR REPLACE TRIGGER trg_validate_quarantine_evidence
BEFORE INSERT ON market.candle_quarantine_evidence
FOR EACH ROW EXECUTE FUNCTION market.validate_quarantine_evidence();
CREATE INDEX IF NOT EXISTS idx_candle_quarantine_lookup
  ON market.candle_quarantine_evidence(symbol, broker, candle_ts, recorded_at DESC);

CREATE OR REPLACE FUNCTION market.reject_quarantine_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '% is append-only: quarantine evidence mutation rejected', TG_TABLE_NAME;
  END IF;
  IF NEW.supersedes_quarantine_evidence_id IS NOT NULL
     AND NEW.supersedes_quarantine_evidence_id = NEW.quarantine_evidence_id THEN
    RAISE EXCEPTION 'quarantine evidence cannot supersede itself';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candle_quarantine_append_only ON market.candle_quarantine_evidence;
CREATE OR REPLACE TRIGGER trg_candle_quarantine_append_only
BEFORE INSERT OR UPDATE OR DELETE ON market.candle_quarantine_evidence
FOR EACH ROW EXECUTE FUNCTION market.reject_quarantine_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS uq_quarantine_one_successor
  ON market.candle_quarantine_evidence(supersedes_quarantine_evidence_id)
  WHERE supersedes_quarantine_evidence_id IS NOT NULL;

CREATE OR REPLACE FUNCTION market.resolve_quarantine_evidence(
  p_symbol TEXT, p_broker TEXT, p_candle_ts TIMESTAMPTZ, p_policy_version TEXT
) RETURNS BIGINT LANGUAGE plpgsql STABLE AS $$
DECLARE v_id BIGINT;
BEGIN
  SELECT quarantine_evidence_id INTO STRICT v_id
  FROM market.candle_quarantine_evidence q
  WHERE q.symbol = p_symbol AND q.broker = p_broker
    AND q.candle_ts = p_candle_ts AND q.policy_version = p_policy_version
    AND q.disposition = 'APPROVED'
    AND NOT EXISTS (
      SELECT 1 FROM market.candle_quarantine_evidence newer
      WHERE newer.supersedes_quarantine_evidence_id = q.quarantine_evidence_id
    );
  RETURN v_id;
EXCEPTION WHEN NO_DATA_FOUND THEN
  RAISE EXCEPTION 'no approved quarantine evidence for %/% at %', p_symbol, p_broker, p_candle_ts;
       WHEN TOO_MANY_ROWS THEN
  RAISE EXCEPTION 'multiple approved quarantine evidence rows for %/% at %', p_symbol, p_broker, p_candle_ts;
END;
$$;

CREATE OR REPLACE FUNCTION market.xauusd_expected_minutes(
  p_interval_start TIMESTAMPTZ, p_interval_end TIMESTAMPTZ,
  p_calendar_version TEXT
) RETURNS TABLE(minute_ts TIMESTAMPTZ) LANGUAGE SQL STABLE AS $$
  SELECT g
  FROM generate_series(
    date_trunc('minute', p_interval_start),
    date_trunc('minute', p_interval_end - interval '1 minute'), interval '1 minute') AS s(g)
  CROSS JOIN market.candle_calendar_policy cp
  WHERE g >= p_interval_start AND g < p_interval_end
    AND cp.calendar_version = p_calendar_version
    AND (g AT TIME ZONE cp.timezone)::time >= time '00:00'
    AND EXTRACT(DOW FROM g AT TIME ZONE cp.timezone) <> 6
    AND NOT (EXTRACT(DOW FROM g AT TIME ZONE cp.timezone) = cp.weekend_reopen_dow
             AND EXTRACT(HOUR FROM g AT TIME ZONE cp.timezone) < cp.weekend_reopen_hour)
    AND NOT (EXTRACT(DOW FROM g AT TIME ZONE cp.timezone) = cp.weekend_close_dow
             AND EXTRACT(HOUR FROM g AT TIME ZONE cp.timezone) >= cp.weekend_close_hour)
    AND NOT (
      (EXTRACT(HOUR FROM g AT TIME ZONE cp.timezone) * 60
       + EXTRACT(MINUTE FROM g AT TIME ZONE cp.timezone))
      BETWEEN cp.daily_break_start_hour * 60
          AND cp.daily_break_start_hour * 60 + cp.daily_break_minutes - 1
    )
$$;
CREATE INDEX IF NOT EXISTS idx_xauusd_expected_minute_interval
  ON market.xauusd_expected_minute(interval_start, interval_end, minute_ts);

CREATE TABLE IF NOT EXISTS market.htf_authority_bundle (
  authority_bundle_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  interval_start TIMESTAMPTZ NOT NULL,
  interval_end TIMESTAMPTZ NOT NULL,
  calendar_version TEXT NOT NULL,
  expected_set_sha256 TEXT NOT NULL CHECK (expected_set_sha256 ~ '^[0-9a-f]{64}$'),
  parent_identity_sha256 TEXT NOT NULL CHECK (parent_identity_sha256 ~ '^[0-9a-f]{64}$'),
  parent_count INTEGER NOT NULL CHECK (parent_count > 0),
  finalization_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (finalization_status IN ('DRAFT','FINALIZED')),
  finalized_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (interval_end > interval_start),
  CHECK ((finalization_status = 'FINALIZED') = (finalized_at IS NOT NULL)),
  UNIQUE (symbol, timeframe, interval_start, interval_end, calendar_version, parent_identity_sha256)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = 'market.htf_authority_bundle'::regclass
                   AND attname = 'finalization_status' AND NOT attisdropped) THEN
    ALTER TABLE market.htf_authority_bundle ADD COLUMN finalization_status TEXT NOT NULL DEFAULT 'DRAFT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = 'market.htf_authority_bundle'::regclass
                   AND attname = 'finalized_at' AND NOT attisdropped) THEN
    ALTER TABLE market.htf_authority_bundle ADD COLUMN finalized_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS market.htf_authority_bundle_parent (
  authority_bundle_id BIGINT NOT NULL REFERENCES market.htf_authority_bundle(authority_bundle_id),
  parent_ts TIMESTAMPTZ NOT NULL,
  raw_evidence_id BIGINT NOT NULL,
  source_key TEXT NOT NULL,
  authority_snapshot_id BIGINT NOT NULL REFERENCES market.candle_authority_snapshot(authority_snapshot_id),
  quarantine_evidence_id BIGINT NOT NULL REFERENCES market.candle_quarantine_evidence(quarantine_evidence_id),
  parent_content_sha256 TEXT NOT NULL CHECK (parent_content_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (authority_bundle_id, parent_ts),
  UNIQUE (authority_bundle_id, raw_evidence_id)
);

CREATE OR REPLACE FUNCTION market.reject_authority_bundle_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'htf_authority_bundle' AND TG_OP = 'INSERT'
     AND NEW.finalization_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'finalized authority bundle must be created through finalize_authority_bundle';
  END IF;
  IF TG_TABLE_NAME = 'htf_authority_bundle' AND TG_OP = 'UPDATE'
     AND OLD.finalization_status = 'DRAFT'
     AND NEW.finalization_status = 'FINALIZED'
    AND current_setting('market.provenance_finalizer', true) = '193'
    AND current_user = pg_get_userbyid((SELECT p.proowner FROM pg_proc p
             WHERE p.oid = 'market.finalize_authority_bundle(bigint)'::regprocedure))
    AND pg_has_role(
          session_user,
          pg_get_userbyid((SELECT p.proowner FROM pg_proc p
                           WHERE p.oid = 'market.finalize_authority_bundle(bigint)'::regprocedure)),
          'member'
        ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '% is append-only: authority bundle mutation rejected', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION market.finalize_authority_bundle(p_bundle_id BIGINT)
RETURNS TABLE(authority_bundle_id BIGINT, finalization_status TEXT, finalized_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = market, pg_catalog AS $$
DECLARE b market.htf_authority_bundle%ROWTYPE;
BEGIN
  PERFORM set_config('market.provenance_finalizer', '193', true);
  SELECT * INTO b FROM market.htf_authority_bundle
    WHERE htf_authority_bundle.authority_bundle_id = p_bundle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'authority bundle % not found', p_bundle_id; END IF;
  IF b.finalization_status = 'FINALIZED' THEN
    RETURN QUERY SELECT b.authority_bundle_id, b.finalization_status, b.finalized_at;
    RETURN;
  END IF;
  PERFORM market.validate_authority_bundle_set(p_bundle_id);
  UPDATE market.htf_authority_bundle
  SET finalization_status = 'FINALIZED', finalized_at = clock_timestamp()
  WHERE authority_bundle_id = p_bundle_id AND finalization_status = 'DRAFT';
  RETURN QUERY SELECT h.authority_bundle_id, h.finalization_status, h.finalized_at
    FROM market.htf_authority_bundle h WHERE h.authority_bundle_id = p_bundle_id;
END;
$$;

REVOKE ALL ON FUNCTION market.finalize_authority_bundle(BIGINT) FROM PUBLIC;

-- Dedicated non-login owner. Deployment must grant this role to the reviewed
-- finalizer role(s); ordinary application/operator roles receive no EXECUTE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_provenance_finalizer') THEN
    CREATE ROLE market_provenance_finalizer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
ALTER FUNCTION market.finalize_authority_bundle(BIGINT) OWNER TO market_provenance_finalizer;
GRANT EXECUTE ON FUNCTION market.finalize_authority_bundle(BIGINT) TO market_provenance_finalizer;

CREATE OR REPLACE FUNCTION market.validate_authority_bundle_set(p_bundle_id BIGINT)
RETURNS VOID LANGUAGE plpgsql STABLE AS $$
DECLARE
  b RECORD;
  expected_count INTEGER;
  actual_count INTEGER;
  missing_count INTEGER;
  unexpected_count INTEGER;
  unresolved_count INTEGER;
BEGIN
  SELECT * INTO STRICT b FROM market.htf_authority_bundle
  WHERE authority_bundle_id = p_bundle_id
  FOR SHARE;
  SELECT count(*) INTO expected_count
  FROM market.xauusd_expected_minutes(b.interval_start, b.interval_end, b.calendar_version);
  SELECT count(*) INTO actual_count
  FROM market.htf_authority_bundle_parent WHERE authority_bundle_id = p_bundle_id;
  SELECT count(*) INTO missing_count
  FROM market.xauusd_expected_minutes(b.interval_start, b.interval_end, b.calendar_version) e
  WHERE NOT EXISTS (SELECT 1 FROM market.htf_authority_bundle_parent p
                    WHERE p.authority_bundle_id = p_bundle_id AND p.parent_ts = e.minute_ts);
  SELECT count(*) INTO unexpected_count
  FROM market.htf_authority_bundle_parent p
  WHERE p.authority_bundle_id = p_bundle_id
    AND NOT EXISTS (SELECT 1 FROM market.xauusd_expected_minutes(b.interval_start, b.interval_end, b.calendar_version) e
                    WHERE e.minute_ts = p.parent_ts);
  SELECT count(*) INTO unresolved_count
  FROM market.htf_authority_bundle_parent p
  WHERE p.authority_bundle_id = p_bundle_id
    AND market.resolve_quarantine_evidence(
      b.symbol, (SELECT r.broker FROM market.raw_candle_evidence r WHERE r.raw_evidence_id = p.raw_evidence_id),
      p.parent_ts, (SELECT a.policy_version
            FROM market.candle_authority_snapshot a
            WHERE a.authority_snapshot_id = p.authority_snapshot_id)) IS NULL;
  IF EXISTS (
    SELECT 1
    FROM market.htf_authority_bundle_parent p
    LEFT JOIN market.raw_candle_evidence r ON r.raw_evidence_id = p.raw_evidence_id
    LEFT JOIN market.candle_ingestion_run_evidence ir ON ir.ingestion_run_id = r.ingestion_run_id
    LEFT JOIN market.candle_authority_snapshot a ON a.authority_snapshot_id = p.authority_snapshot_id
    WHERE p.authority_bundle_id = p_bundle_id
      AND (r.raw_evidence_id IS NULL
        OR r.symbol IS DISTINCT FROM b.symbol
        OR r.timeframe IS DISTINCT FROM '1m'
        OR r.candle_ts IS DISTINCT FROM p.parent_ts
        OR r.source_key IS DISTINCT FROM p.source_key
        OR r.authority_snapshot_id IS DISTINCT FROM p.authority_snapshot_id
        OR ir.symbol IS DISTINCT FROM r.symbol
        OR ir.broker IS DISTINCT FROM r.broker
        OR ir.timeframe IS DISTINCT FROM r.timeframe
        OR ir.status IS DISTINCT FROM 'success'
        OR a.symbol IS DISTINCT FROM r.symbol
        OR a.broker IS DISTINCT FROM r.broker
        OR a.calendar_version IS DISTINCT FROM b.calendar_version
        OR a.effective_from > r.candle_ts
        OR (a.effective_to IS NOT NULL AND r.candle_ts >= a.effective_to)
        OR p.parent_content_sha256 IS DISTINCT FROM r.content_sha256
        OR p.quarantine_evidence_id IS DISTINCT FROM market.resolve_quarantine_evidence(
          r.symbol, r.broker, r.candle_ts, a.policy_version))
  ) THEN
    RAISE EXCEPTION 'authority bundle % contains parent identity mismatch', p_bundle_id;
  END IF;
  IF actual_count <> expected_count OR missing_count <> 0 OR unexpected_count <> 0 OR unresolved_count <> 0 THEN
    RAISE EXCEPTION 'authority bundle % set mismatch: expected %, actual %, missing %, unexpected %, unresolved %',
      p_bundle_id, expected_count, actual_count, missing_count, unexpected_count, unresolved_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION market.validate_authority_bundle_deferred()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM market.validate_authority_bundle_set(
    CASE WHEN TG_TABLE_NAME = 'htf_authority_bundle'
      THEN NEW.authority_bundle_id
      ELSE NEW.authority_bundle_id
    END);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_htf_authority_bundle_append_only ON market.htf_authority_bundle;
CREATE OR REPLACE TRIGGER trg_htf_authority_bundle_append_only
BEFORE UPDATE OR DELETE ON market.htf_authority_bundle
FOR EACH ROW EXECUTE FUNCTION market.reject_authority_bundle_mutation();
DROP TRIGGER IF EXISTS trg_htf_authority_bundle_parent_append_only ON market.htf_authority_bundle_parent;
CREATE OR REPLACE TRIGGER trg_htf_authority_bundle_parent_append_only
BEFORE UPDATE OR DELETE ON market.htf_authority_bundle_parent
FOR EACH ROW EXECUTE FUNCTION market.reject_authority_bundle_mutation();

DROP TRIGGER IF EXISTS trg_validate_authority_bundle_set ON market.htf_authority_bundle;
CREATE CONSTRAINT TRIGGER trg_validate_authority_bundle_set
AFTER INSERT ON market.htf_authority_bundle
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION market.validate_authority_bundle_deferred();

DROP TRIGGER IF EXISTS trg_validate_authority_bundle_parents ON market.htf_authority_bundle_parent;
CREATE CONSTRAINT TRIGGER trg_validate_authority_bundle_parents
AFTER INSERT ON market.htf_authority_bundle_parent
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION market.validate_authority_bundle_deferred();

CREATE OR REPLACE FUNCTION market.reject_authority_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '% is append-only: authority mutation rejected', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candle_authority_append_only ON market.candle_authority_snapshot;
CREATE OR REPLACE TRIGGER trg_candle_authority_append_only
BEFORE UPDATE OR DELETE ON market.candle_authority_snapshot
FOR EACH ROW EXECUTE FUNCTION market.reject_authority_mutation();
DROP TRIGGER IF EXISTS trg_xauusd_expected_minute_append_only ON market.xauusd_expected_minute;
CREATE OR REPLACE TRIGGER trg_xauusd_expected_minute_append_only
BEFORE UPDATE OR DELETE ON market.xauusd_expected_minute
FOR EACH ROW EXECUTE FUNCTION market.reject_authority_mutation();

CREATE OR REPLACE FUNCTION market.provenance_field(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT length(convert_to(p_value, 'UTF8'))::text || ':' || p_value
$$;

CREATE OR REPLACE FUNCTION market.provenance_nullable_field(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_value IS NULL THEN '-:' ELSE market.provenance_field(p_value) END
$$;

CREATE OR REPLACE FUNCTION market.canonical_number(p_value DOUBLE PRECISION)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
BEGIN
  IF p_value::text IN ('NaN', 'Infinity', '-Infinity') OR p_value <> p_value THEN
    RAISE EXCEPTION 'non-finite numeric value is forbidden';
  END IF;
  RETURN p_value::text;
END;
$$;

CREATE OR REPLACE FUNCTION market.raw_candle_hash(
  p_symbol TEXT, p_broker TEXT, p_timeframe TEXT, p_candle_ts TIMESTAMPTZ,
  p_o DOUBLE PRECISION, p_h DOUBLE PRECISION, p_l DOUBLE PRECISION,
  p_c DOUBLE PRECISION, p_v BIGINT, p_spread DOUBLE PRECISION, p_digits SMALLINT
) RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(digest(
    'sha256-v1-utc-canonical-number|' ||
    market.provenance_field(p_symbol) || market.provenance_field(p_broker) ||
    market.provenance_field(p_timeframe) ||
    market.provenance_field(to_char(p_candle_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ||
    market.provenance_nullable_field(market.canonical_number(p_o)) ||
    market.provenance_nullable_field(market.canonical_number(p_h)) ||
    market.provenance_nullable_field(market.canonical_number(p_l)) ||
    market.provenance_nullable_field(market.canonical_number(p_c)) ||
    market.provenance_nullable_field(p_v::text) ||
    market.provenance_nullable_field(market.canonical_number(p_spread)) ||
    market.provenance_nullable_field(p_digits::text), 'sha256'), 'hex')
$$;

CREATE TABLE IF NOT EXISTS market.candle_ingestion_run_evidence (
  ingestion_run_id BIGINT PRIMARY KEY REFERENCES market.candle_ingestion_runs(run_id),
  source_system TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe = '1m'),
  broker TEXT NOT NULL,
  artifact_id UUID,
  artifact_sha256 TEXT NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  batch_start_ts TIMESTAMPTZ NOT NULL,
  batch_end_ts TIMESTAMPTZ NOT NULL CHECK (batch_end_ts > batch_start_ts),
  raw_span_min_ts TIMESTAMPTZ,
  raw_span_max_ts TIMESTAMPTZ,
  engine_ver TEXT NOT NULL,
  terminal_login BIGINT,
  terminal_server TEXT,
  source_instance_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'success'),
  evidence_fingerprint TEXT NOT NULL CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cire_identity
  ON market.candle_ingestion_run_evidence(symbol, broker, timeframe, ingestion_run_id);

CREATE TABLE IF NOT EXISTS market.raw_candle_evidence (
  raw_evidence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ingestion_run_id BIGINT NOT NULL REFERENCES market.candle_ingestion_run_evidence(ingestion_run_id),
  source_key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe = '1m'),
  broker TEXT NOT NULL,
  candle_ts TIMESTAMPTZ NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v BIGINT,
  spread DOUBLE PRECISION,
  digits SMALLINT,
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (o::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (h::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (l::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (c::text NOT IN ('NaN','Infinity','-Infinity')),
  CHECK (spread IS NULL OR spread::text NOT IN ('NaN','Infinity','-Infinity')),
  hash_algorithm TEXT NOT NULL CHECK (hash_algorithm = 'sha256-v1-utc-canonical-number'),
  supersedes_raw_evidence_id BIGINT,
  authority_snapshot_id BIGINT NOT NULL REFERENCES market.candle_authority_snapshot(authority_snapshot_id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ingestion_run_id, source_key, candle_ts),
  UNIQUE (raw_evidence_id, ingestion_run_id),
  UNIQUE (raw_evidence_id, ingestion_run_id, symbol, broker, timeframe, candle_ts)
);

CREATE OR REPLACE FUNCTION market.reject_provenance_run_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'running' THEN
    RAISE EXCEPTION 'ingestion run % is finalized and immutable', OLD.run_id;
  END IF;
  IF NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.symbol IS DISTINCT FROM OLD.symbol
     OR NEW.timeframe IS DISTINCT FROM OLD.timeframe
     OR NEW.broker IS DISTINCT FROM OLD.broker
     OR NEW.batch_start_ts IS DISTINCT FROM OLD.batch_start_ts
     OR NEW.batch_end_ts IS DISTINCT FROM OLD.batch_end_ts
     OR NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
     OR NEW.artifact_sha256 IS DISTINCT FROM OLD.artifact_sha256
     OR NEW.source_system IS DISTINCT FROM OLD.source_system
     OR NEW.engine_ver IS DISTINCT FROM OLD.engine_ver
     OR NEW.terminal_login IS DISTINCT FROM OLD.terminal_login
     OR NEW.terminal_server IS DISTINCT FROM OLD.terminal_server THEN
    RAISE EXCEPTION 'ingestion run % identity mutation rejected', OLD.run_id;
  END IF;
  IF NEW.status = 'success' AND (NEW.completed_at IS NULL
     OR NEW.rows_seen IS NULL OR NEW.rows_seen < 0
     OR NEW.rows_inserted IS NULL OR NEW.rows_inserted < 0
     OR NEW.rows_rejected IS NULL OR NEW.rows_rejected < 0
     OR NEW.rows_inserted + NEW.rows_rejected <> NEW.rows_seen
     OR NEW.raw_span_min_ts IS NULL
     OR NEW.raw_span_max_ts IS NULL
     OR NEW.raw_span_max_ts < NEW.raw_span_min_ts
     OR NEW.artifact_id IS NOT NULL AND NEW.artifact_sha256 IS NULL) THEN
    RAISE EXCEPTION 'ingestion run % lacks complete terminal evidence', OLD.run_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_provenance_run_finality ON market.candle_ingestion_runs;
CREATE OR REPLACE TRIGGER trg_provenance_run_finality
BEFORE UPDATE OR DELETE ON market.candle_ingestion_runs
FOR EACH ROW EXECUTE FUNCTION market.reject_provenance_run_mutation();
ALTER TABLE market.raw_candle_evidence
  ADD CONSTRAINT raw_candle_evidence_supersedes_fk
  FOREIGN KEY (supersedes_raw_evidence_id) REFERENCES market.raw_candle_evidence(raw_evidence_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_one_successor
  ON market.raw_candle_evidence(supersedes_raw_evidence_id)
  WHERE supersedes_raw_evidence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_candle_evidence_lookup
  ON market.raw_candle_evidence(symbol, timeframe, candle_ts);

CREATE TABLE IF NOT EXISTS market.canonical_candle_selection_lineage (
  canonical_lineage_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  candle_ts TIMESTAMPTZ NOT NULL,
  canonical_version TEXT NOT NULL,
  raw_evidence_id BIGINT NOT NULL,
  raw_ingestion_run_id BIGINT NOT NULL,
  raw_symbol TEXT NOT NULL,
  raw_broker TEXT NOT NULL,
  raw_timeframe TEXT NOT NULL CHECK (raw_timeframe = '1m'),
  raw_candle_ts TIMESTAMPTZ NOT NULL,
  broker_policy_id BIGINT,
  broker_policy_version TEXT NOT NULL,
  selection_reason TEXT NOT NULL,
  quarantine_state TEXT NOT NULL CHECK (quarantine_state IN ('NONE','BLOCKED','RELEASED')),
  selection_fingerprint TEXT NOT NULL CHECK (selection_fingerprint ~ '^[0-9a-f]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_canonical_lineage_id BIGINT,
  FOREIGN KEY (raw_evidence_id, raw_ingestion_run_id)
    REFERENCES market.raw_candle_evidence(raw_evidence_id, ingestion_run_id),
  FOREIGN KEY (raw_evidence_id, raw_ingestion_run_id, raw_symbol, raw_broker, raw_timeframe, raw_candle_ts)
    REFERENCES market.raw_candle_evidence(raw_evidence_id, ingestion_run_id, symbol, broker, timeframe, candle_ts),
  UNIQUE (symbol, timeframe, candle_ts, canonical_version),
  UNIQUE (symbol, timeframe, candle_ts, canonical_version, raw_evidence_id)
);
ALTER TABLE market.canonical_candle_selection_lineage
  ADD CONSTRAINT canonical_lineage_supersedes_fk
  FOREIGN KEY (supersedes_canonical_lineage_id)
  REFERENCES market.canonical_candle_selection_lineage(canonical_lineage_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_one_successor
  ON market.canonical_candle_selection_lineage(supersedes_canonical_lineage_id)
  WHERE supersedes_canonical_lineage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_candle_lineage_lookup
  ON market.canonical_candle_selection_lineage(symbol, timeframe, candle_ts, canonical_version);

CREATE TABLE IF NOT EXISTS market.htf_candle_derivation_lineage (
  derivation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe <> '1m'),
  candle_ts TIMESTAMPTZ NOT NULL,
  canonical_version TEXT NOT NULL,
  canonical_lineage_id BIGINT NOT NULL,
  aggregation_version TEXT NOT NULL,
  certified_manifest_sha256 TEXT NOT NULL CHECK (certified_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  child_count INTEGER NOT NULL CHECK (child_count > 0),
  aggregation_fingerprint TEXT NOT NULL CHECK (aggregation_fingerprint ~ '^[0-9a-f]{64}$'),
  calendar_rule_version TEXT NOT NULL,
  calendar_state TEXT NOT NULL CHECK (calendar_state IN ('VALID','BLOCKED')),
  eligibility_policy_version TEXT NOT NULL,
  eligibility_state TEXT NOT NULL CHECK (eligibility_state IN ('PROVEN','BLOCKED')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_derivation_id BIGINT,
  authority_bundle_id BIGINT NOT NULL REFERENCES market.htf_authority_bundle(authority_bundle_id),
  UNIQUE (symbol, timeframe, candle_ts, canonical_version),
  FOREIGN KEY (canonical_lineage_id)
    REFERENCES market.canonical_candle_selection_lineage(canonical_lineage_id),
  FOREIGN KEY (supersedes_derivation_id)
    REFERENCES market.htf_candle_derivation_lineage(derivation_id),
  CHECK (timeframe = '15m' OR eligibility_state = 'BLOCKED')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_derivation_one_successor
  ON market.htf_candle_derivation_lineage(supersedes_derivation_id)
  WHERE supersedes_derivation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS market.htf_candle_derivation_child (
  derivation_id BIGINT NOT NULL REFERENCES market.htf_candle_derivation_lineage(derivation_id),
  child_ts TIMESTAMPTZ NOT NULL,
  child_raw_evidence_id BIGINT NOT NULL,
  child_ingestion_run_id BIGINT NOT NULL,
  child_canonical_lineage_id BIGINT NOT NULL,
  child_symbol TEXT NOT NULL,
  child_broker TEXT NOT NULL,
  child_timeframe TEXT NOT NULL CHECK (child_timeframe = '1m'),
  child_canonical_version TEXT NOT NULL,
  child_content_sha256 TEXT NOT NULL CHECK (child_content_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (derivation_id, child_ts),
  FOREIGN KEY (child_raw_evidence_id, child_ingestion_run_id)
    REFERENCES market.raw_candle_evidence(raw_evidence_id, ingestion_run_id),
  FOREIGN KEY (child_canonical_lineage_id)
    REFERENCES market.canonical_candle_selection_lineage(canonical_lineage_id),
  FOREIGN KEY (child_symbol, child_timeframe, child_ts, child_canonical_version)
    REFERENCES market.canonical_candle_selection_lineage(symbol, timeframe, candle_ts, canonical_version),
  FOREIGN KEY (child_raw_evidence_id, child_ingestion_run_id, child_symbol, child_broker, child_timeframe, child_ts)
    REFERENCES market.raw_candle_evidence(raw_evidence_id, ingestion_run_id, symbol, broker, timeframe, candle_ts),
  UNIQUE (derivation_id, child_raw_evidence_id)
);

CREATE OR REPLACE FUNCTION market.reject_candle_provenance_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '% is append-only: mutation rejected', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'candle_ingestion_run_evidence',
    'raw_candle_evidence',
    'canonical_candle_selection_lineage',
    'htf_candle_derivation_lineage',
    'htf_candle_derivation_child'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON market.%I', 'trg_' || t || '_append_only', t);
    EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE UPDATE OR DELETE ON market.%I FOR EACH ROW EXECUTE FUNCTION market.reject_candle_provenance_mutation()', 'trg_' || t || '_append_only', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION market.validate_15m_derivation_children()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d RECORD; n INTEGER;
BEGIN
  SELECT * INTO d FROM market.htf_candle_derivation_lineage WHERE derivation_id = NEW.derivation_id;
  IF d.timeframe = '15m' AND d.eligibility_state = 'PROVEN' THEN
    IF NOT EXISTS (
      SELECT 1 FROM market.canonical_candle_selection_lineage l
      WHERE l.canonical_lineage_id = d.canonical_lineage_id
        AND l.symbol = d.symbol AND l.timeframe = d.timeframe
        AND l.candle_ts = d.candle_ts
        AND l.canonical_version = d.canonical_version
        AND l.quarantine_state IN ('NONE','RELEASED')
    ) THEN
      RAISE EXCEPTION '15m derivation % has no eligible canonical parent', d.derivation_id;
    END IF;
    SELECT count(*) INTO n FROM market.htf_candle_derivation_child WHERE derivation_id = d.derivation_id;
    IF d.calendar_state <> 'VALID'
       OR d.child_count <> n
       OR n <> 15
       OR EXISTS (
      SELECT 1 FROM market.htf_candle_derivation_child c
      WHERE c.derivation_id = d.derivation_id
        AND (c.child_ts <> date_trunc('minute', c.child_ts)
          OR c.child_ts <> d.candle_ts + ((extract(epoch FROM (c.child_ts - d.candle_ts))::bigint / 60) * interval '1 minute'))
    ) OR EXISTS (
      SELECT 1 FROM market.htf_candle_derivation_child c
      WHERE c.derivation_id = d.derivation_id
        AND (c.child_ts < d.candle_ts
          OR c.child_ts >= d.candle_ts + interval '15 minutes')
    ) OR EXISTS (
      SELECT 1
      FROM market.htf_candle_derivation_child c
      JOIN market.raw_candle_evidence r ON r.raw_evidence_id = c.child_raw_evidence_id
      WHERE c.derivation_id = d.derivation_id
        AND c.child_content_sha256 <> r.content_sha256
    ) OR EXISTS (
      SELECT 1
      FROM market.htf_candle_derivation_child c
      JOIN market.canonical_candle_selection_lineage l
        ON l.canonical_lineage_id = c.child_canonical_lineage_id
      WHERE c.derivation_id = d.derivation_id
        AND (l.symbol, l.timeframe, l.candle_ts, l.canonical_version)
            IS DISTINCT FROM (c.child_symbol, c.child_timeframe, c.child_ts, c.child_canonical_version)
    ) OR EXISTS (
      SELECT 1
      FROM market.htf_candle_derivation_child c
      JOIN market.canonical_candle_selection_lineage l
        ON l.canonical_lineage_id = c.child_canonical_lineage_id
      WHERE c.derivation_id = d.derivation_id
        AND l.quarantine_state NOT IN ('NONE','RELEASED')
    ) THEN
      RAISE EXCEPTION '15m derivation % requires exactly 15 aligned 1m children', d.derivation_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_15m_derivation_children ON market.htf_candle_derivation_child;
CREATE CONSTRAINT TRIGGER trg_validate_15m_derivation_children
AFTER INSERT ON market.htf_candle_derivation_child
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION market.validate_15m_derivation_children();

DROP TRIGGER IF EXISTS trg_validate_15m_derivation_lineage ON market.htf_candle_derivation_lineage;
CREATE CONSTRAINT TRIGGER trg_validate_15m_derivation_lineage
AFTER INSERT ON market.htf_candle_derivation_lineage
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION market.validate_15m_derivation_children();

CREATE OR REPLACE FUNCTION market.validate_candle_provenance_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD; s RECORD; p RECORD;
  cycle_found BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'candle_ingestion_run_evidence' THEN
    SELECT * INTO s FROM market.candle_ingestion_runs WHERE run_id = NEW.ingestion_run_id FOR KEY SHARE;
    IF NOT FOUND OR s.status IS DISTINCT FROM 'success'
       OR s.symbol IS DISTINCT FROM NEW.symbol
       OR s.broker IS DISTINCT FROM NEW.broker
       OR s.timeframe IS DISTINCT FROM NEW.timeframe
       OR s.batch_start_ts > NEW.batch_start_ts
       OR s.batch_end_ts < NEW.batch_end_ts THEN
      RAISE EXCEPTION 'ingestion run % is not successful', NEW.ingestion_run_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'canonical_candle_selection_lineage' THEN
    IF NEW.supersedes_canonical_lineage_id = NEW.canonical_lineage_id THEN
      RAISE EXCEPTION 'canonical lineage cannot supersede itself';
    END IF;
    IF NEW.supersedes_canonical_lineage_id IS NOT NULL THEN
      SELECT * INTO p FROM market.canonical_candle_selection_lineage WHERE canonical_lineage_id = NEW.supersedes_canonical_lineage_id;
      IF NOT FOUND OR (p.symbol,p.timeframe,p.candle_ts) IS DISTINCT FROM (NEW.symbol,NEW.timeframe,NEW.candle_ts) THEN
        RAISE EXCEPTION 'canonical supersession changes identity';
      END IF;
    END IF;
    IF NEW.selection_fingerprint <> encode(digest(
      jsonb_build_array(NEW.symbol, NEW.timeframe, NEW.candle_ts,
        NEW.canonical_version, NEW.raw_evidence_id, NEW.raw_ingestion_run_id,
        NEW.raw_symbol, NEW.raw_broker, NEW.raw_timeframe, NEW.raw_candle_ts,
        NEW.broker_policy_id, NEW.broker_policy_version, NEW.selection_reason,
        NEW.quarantine_state)::text, 'sha256'), 'hex') THEN
      RAISE EXCEPTION 'canonical selection fingerprint does not match canonical serialization';
    END IF;
    IF NEW.supersedes_canonical_lineage_id IS NOT NULL THEN
      WITH RECURSIVE chain(canonical_lineage_id) AS (
        SELECT NEW.supersedes_canonical_lineage_id
        UNION ALL
        SELECT x.supersedes_canonical_lineage_id
        FROM market.canonical_candle_selection_lineage x JOIN chain c
          ON x.canonical_lineage_id = c.canonical_lineage_id
        WHERE x.supersedes_canonical_lineage_id IS NOT NULL
      ) SELECT EXISTS (SELECT 1 FROM chain WHERE canonical_lineage_id = NEW.canonical_lineage_id)
        INTO cycle_found;
      IF cycle_found THEN RAISE EXCEPTION 'canonical supersession cycle detected'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'raw_candle_evidence' THEN
    IF NEW.authority_snapshot_id IS DISTINCT FROM
       market.resolve_candle_authority(NEW.symbol, NEW.broker, NEW.candle_ts) THEN
      RAISE EXCEPTION 'caller-selected authority snapshot is not database-resolved authority';
    END IF;
    SELECT * INTO p FROM market.candle_authority_snapshot
      WHERE authority_snapshot_id = NEW.authority_snapshot_id
        AND symbol = NEW.symbol AND broker = NEW.broker
        AND effective_from <= NEW.candle_ts
        AND (effective_to IS NULL OR NEW.candle_ts < effective_to);
    IF NOT FOUND OR NOT p.broker_allowed OR p.quarantine_state NOT IN ('NONE','RELEASED') THEN
      RAISE EXCEPTION 'raw evidence % lacks active admissible authority snapshot', NEW.source_key;
    END IF;
    IF NEW.supersedes_raw_evidence_id IS NOT NULL THEN
      SELECT * INTO p FROM market.raw_candle_evidence
       WHERE raw_evidence_id = NEW.supersedes_raw_evidence_id;
      IF NOT FOUND OR (p.symbol,p.broker,p.timeframe,p.candle_ts) IS DISTINCT FROM
         (NEW.symbol,NEW.broker,NEW.timeframe,NEW.candle_ts) THEN
        RAISE EXCEPTION 'raw supersession changes identity';
      END IF;
      WITH RECURSIVE chain(raw_evidence_id) AS (
        SELECT NEW.supersedes_raw_evidence_id
        UNION ALL
        SELECT x.supersedes_raw_evidence_id
        FROM market.raw_candle_evidence x JOIN chain c
          ON x.raw_evidence_id = c.raw_evidence_id
        WHERE x.supersedes_raw_evidence_id IS NOT NULL
      ) SELECT EXISTS (SELECT 1 FROM chain WHERE raw_evidence_id = NEW.raw_evidence_id)
        INTO cycle_found;
      IF cycle_found THEN RAISE EXCEPTION 'raw supersession cycle detected'; END IF;
    END IF;
    IF NEW.content_sha256 <> market.raw_candle_hash(
      NEW.symbol, NEW.broker, NEW.timeframe, NEW.candle_ts,
      NEW.o, NEW.h, NEW.l, NEW.c, NEW.v, NEW.spread, NEW.digits) THEN
      RAISE EXCEPTION 'caller content hash does not match database canonical hash';
    END IF;
    NEW.content_sha256 := market.raw_candle_hash(
      NEW.symbol, NEW.broker, NEW.timeframe, NEW.candle_ts,
      NEW.o, NEW.h, NEW.l, NEW.c, NEW.v, NEW.spread, NEW.digits);
  ELSIF TG_TABLE_NAME = 'htf_candle_derivation_lineage' THEN
    IF NOT EXISTS (
      SELECT 1 FROM market.htf_authority_bundle b
      WHERE b.authority_bundle_id = NEW.authority_bundle_id
        AND b.symbol = NEW.symbol AND b.timeframe = NEW.timeframe
        AND b.interval_start = NEW.candle_ts
        AND b.interval_end = NEW.candle_ts + CASE NEW.timeframe
          WHEN '15m' THEN interval '15 minutes'
          WHEN '5m' THEN interval '5 minutes'
          WHEN '1h' THEN interval '1 hour'
          WHEN '4h' THEN interval '4 hours'
          WHEN '1d' THEN interval '1 day'
          ELSE interval '0 seconds'
        END
    ) THEN
      RAISE EXCEPTION 'HTF derivation authority bundle does not match interval';
    END IF;
    IF NEW.supersedes_derivation_id = NEW.derivation_id THEN
      RAISE EXCEPTION 'derivation cannot supersede itself';
    END IF;
    IF NEW.eligibility_state = 'PROVEN' AND NEW.timeframe <> '15m' THEN
      RAISE EXCEPTION 'only 15m derivations may be PROVEN';
    END IF;
    IF NEW.canonical_lineage_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM market.canonical_candle_selection_lineage l
      WHERE l.canonical_lineage_id = NEW.canonical_lineage_id
        AND l.symbol = NEW.symbol AND l.timeframe = NEW.timeframe
        AND l.candle_ts = NEW.candle_ts
        AND l.canonical_version = NEW.canonical_version
    ) THEN
      RAISE EXCEPTION 'derivation canonical parent identity/version mismatch';
    END IF;
    IF NEW.supersedes_derivation_id IS NOT NULL THEN
      WITH RECURSIVE chain(derivation_id) AS (
        SELECT NEW.supersedes_derivation_id
        UNION ALL
        SELECT x.supersedes_derivation_id
        FROM market.htf_candle_derivation_lineage x JOIN chain c
          ON x.derivation_id = c.derivation_id
        WHERE x.supersedes_derivation_id IS NOT NULL
      ) SELECT EXISTS (SELECT 1 FROM chain WHERE derivation_id = NEW.derivation_id)
        INTO cycle_found;
      IF cycle_found THEN RAISE EXCEPTION 'derivation supersession cycle detected'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_validate_ingestion_run_evidence
BEFORE INSERT ON market.candle_ingestion_run_evidence
FOR EACH ROW EXECUTE FUNCTION market.validate_candle_provenance_insert();
CREATE OR REPLACE TRIGGER trg_validate_raw_candle_evidence
BEFORE INSERT ON market.raw_candle_evidence
FOR EACH ROW EXECUTE FUNCTION market.validate_candle_provenance_insert();
CREATE OR REPLACE TRIGGER trg_validate_canonical_selection
BEFORE INSERT ON market.canonical_candle_selection_lineage
FOR EACH ROW EXECUTE FUNCTION market.validate_candle_provenance_insert();
CREATE OR REPLACE TRIGGER trg_validate_derivation_lineage
BEFORE INSERT ON market.htf_candle_derivation_lineage
FOR EACH ROW EXECUTE FUNCTION market.validate_candle_provenance_insert();

COMMENT ON TABLE market.candle_ingestion_run_evidence IS 'Success-only immutable ingestion evidence snapshot; no historical inference.';
COMMENT ON TABLE market.raw_candle_evidence IS 'Immutable source-row identity and deterministic content hash.';
COMMENT ON TABLE market.canonical_candle_selection_lineage IS 'Versioned canonical selection; multiple raw candidates remain valid.';
COMMENT ON TABLE market.htf_candle_derivation_lineage IS 'Immutable HTF aggregation proof over certified 1m children.';

COMMIT;
