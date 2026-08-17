# Index inventory 2026-08-15 (DB-INDEX-01/02, read-only)

- Indexes scanned: 354 (10412.2 MB) across schemas: public, market
- Exact duplicate groups: 0 (reclaimable ~0.0 MB)
- Redundant left-prefix candidates: 8 (~177.4 MB)
- Never-scanned non-constraint indexes: 153

## Exact duplicates
- none

## Redundant left-prefix candidates (review before dropping)
- public.features_moving_average: `idx_features_moving_average_symbol` (86.6 MB, 3699 scans) covered by `idx_features_moving_average_cross_lookup`
- public.features_pricing: `idx_features_pricing_symbol` (32.4 MB, 1847 scans) covered by `idx_features_pricing_pit_cover`
- public.features_zone: `idx_features_zone_symbol` (27.2 MB, 129 scans) covered by `idx_features_zone_pit_cover`
- public.features_ifvg: `idx_features_ifvg_symbol` (13.8 MB, 8 scans) covered by `idx_features_ifvg_pit_cover`
- public.features_structure: `idx_features_structure_symbol` (7.8 MB, 8 scans) covered by `idx_features_structure_pit_cover`
- public.features_direction_state: `idx_features_direction_state_lookup` (7.1 MB, 12 scans) covered by `idx_features_direction_state_pit`
- public.features_order_block: `idx_features_order_block_symbol` (2.5 MB, 8 scans) covered by `idx_features_order_block_pit_cover`
- public.orders: `idx_orders_symbol_status` (0.0 MB, 0 scans) covered by `idx_orders_symbol`

Full detail: index-inventory-2026-08-15.json
