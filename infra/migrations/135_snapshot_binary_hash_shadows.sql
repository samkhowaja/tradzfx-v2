-- Add fixed-width binary SHA-256 shadows without changing current text readers,
-- writers, uniqueness constraints, or foreign-key contracts.
--
-- Generated columns make dual-write deterministic inside PostgreSQL: every insert
-- through every current writer derives the same 32-byte value from content_hash.
-- Existing rows are backfilled by PostgreSQL during this additive migration.
-- Preflight evidence (2026-07-17): both tables contain only lowercase 64-character
-- hex hashes and decode to the same number of distinct binary values.

ALTER TABLE public.feature_config_snapshot
  ADD COLUMN content_hash_bin BYTEA
  GENERATED ALWAYS AS (decode(content_hash, 'hex')) STORED;

ALTER TABLE public.feature_config_snapshot
  ADD CONSTRAINT feature_config_snapshot_content_hash_bin_32_check
  CHECK (octet_length(content_hash_bin) = 32);

ALTER TABLE public.strategy_settings_snapshot
  ADD COLUMN content_hash_bin BYTEA
  GENERATED ALWAYS AS (decode(content_hash, 'hex')) STORED;

ALTER TABLE public.strategy_settings_snapshot
  ADD CONSTRAINT strategy_settings_snapshot_content_hash_bin_32_check
  CHECK (octet_length(content_hash_bin) = 32);
