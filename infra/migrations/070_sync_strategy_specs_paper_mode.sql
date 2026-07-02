-- Safety freeze: ensure DB strategy specs match the paper-mode safety freeze
-- applied to source YAML specs. Any strategy still marked live is forced to paper.
UPDATE strategy_specs
SET spec_json = jsonb_set(
    spec_json,
    '{live,mode}',
    '"paper"'::jsonb,
    true
)
WHERE is_active = true
  AND spec_json -> 'live' ->> 'mode' = 'live';
