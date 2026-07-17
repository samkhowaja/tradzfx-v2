-- 125_spec_version_tracking.sql
-- Adds activated_at / deactivated_at columns to strategy_specs and
-- strategy_variants so version promotions and rollbacks are auditable.
--
-- The trigger function automatically sets activated_at when is_active flips
-- from false→true, and deactivated_at when it flips from true→false.
-- This means a spec that is created with is_active=true gets an activated_at
-- on first INSERT (via the trigger), while one created inactive stays NULL
-- until it is first activated.

BEGIN;

ALTER TABLE strategy_specs
    ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

ALTER TABLE strategy_variants
    ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- Seed activated_at for currently-active rows that have never been toggled.
UPDATE strategy_specs SET activated_at = updated_at WHERE is_active = true AND activated_at IS NULL;
UPDATE strategy_variants SET activated_at = updated_at WHERE is_active = true AND activated_at IS NULL;

-- Trigger function: auto-stamp activation/deactivation.
CREATE OR REPLACE FUNCTION track_spec_activation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.is_active THEN
        NEW.activated_at = COALESCE(NEW.activated_at, NOW());
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.is_active AND NOT OLD.is_active THEN
            NEW.activated_at = NOW();
            NEW.deactivated_at = NULL;
        ELSIF NOT NEW.is_active AND OLD.is_active THEN
            NEW.deactivated_at = NOW();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to both tables.
DROP TRIGGER IF EXISTS trg_strategy_specs_activation ON strategy_specs;
CREATE TRIGGER trg_strategy_specs_activation
    BEFORE INSERT OR UPDATE OF is_active ON strategy_specs
    FOR EACH ROW EXECUTE FUNCTION track_spec_activation();

DROP TRIGGER IF EXISTS trg_strategy_variants_activation ON strategy_variants;
CREATE TRIGGER trg_strategy_variants_activation
    BEFORE INSERT OR UPDATE OF is_active ON strategy_variants
    FOR EACH ROW EXECUTE FUNCTION track_spec_activation();

COMMIT;
