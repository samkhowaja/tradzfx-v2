-- Deactivate live-mode strategy specs that are not currently deployed.
-- This prevents the fallback path (no active live_deployment) from
-- accidentally picking one of them and emitting conflicting setups.
UPDATE strategy_specs
SET is_active = false
WHERE id IN (
  'doyle_sd',
  'orb_classic',
  'smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp',
  'watukushay_no1'
)
  AND is_active = true;
