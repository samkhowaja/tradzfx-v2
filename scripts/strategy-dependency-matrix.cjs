#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
const includeInactive = process.argv.includes('--include-inactive');
const rootArg = process.argv.slice(2).find((arg) => !arg.startsWith('--') && arg !== output);
const root = path.resolve(rootArg || 'packages/strategies/src/specs');
const featurePattern = /features_[a-z0-9_]+/g;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return includeInactive || entry.name !== 'inactive' ? files(full) : [];
    return entry.name.endsWith('.yaml') ? [full] : [];
  });
}
function unique(values) { return [...new Set(values)].sort(); }
function collect(node, result) {
  if (typeof node === 'string') result.push(...(node.match(featurePattern) || []));
  else if (Array.isArray(node)) node.forEach((item) => collect(item, result));
  else if (node && typeof node === 'object') Object.values(node).forEach((value) => collect(value, result));
}
const strategies = files(root).sort().map((file) => {
  const raw = fs.readFileSync(file, 'utf8');
  let doc;
  try { doc = yaml.load(raw); } catch (error) { return { file: path.relative(process.cwd(), file), parseError: error.message, features: [] }; }
  const found = [];
  collect(doc, found);
  const features = unique(found);
  return { file: path.relative(process.cwd(), file), id: doc?.id || path.basename(file, '.yaml'), familyId: doc?.familyId || null, active: !file.includes(`${path.sep}inactive${path.sep}`), features, status: features.some((feature) => ['features_pivot','features_structure','features_sweep','features_bias','features_direction_state','features_order_block','features_pricing','features_push_pull','features_liquidity_event_v2','features_zone_retest','features_ifvg'].includes(feature)) ? 'BLOCKED_CONTAMINATED_DEPENDENCY' : 'CANDLE_OR_UNCLASSIFIED' };
});
const byFeature = {};
for (const strategy of strategies) for (const feature of strategy.features) (byFeature[feature] ||= []).push(strategy.id);
for (const ids of Object.values(byFeature)) ids.sort();
const report = { generatedAt: new Date().toISOString(), specsRoot: path.relative(process.cwd(), root), includeInactive, strategyCount: strategies.length, featureCount: Object.keys(byFeature).length, byFeature, strategies };
const serialized = JSON.stringify(report, null, 2);
if (output) fs.writeFileSync(output, serialized + '\n');
console.log(serialized);
