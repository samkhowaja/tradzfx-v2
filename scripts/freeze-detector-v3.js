#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const VERSION = 'candle-detector-v3-robust';
const CONFIG = {
  baseline: { method: 'median_mad', scope: 'symbol_effective_broker_timeframe', lookbackBars: 60 },
  metrics: ['returns', 'ranges', 'spreads'],
  thresholds: {
    fx_major: { madMultiplier: 8, hardFloorReturn: 0.005 },
    jpy: { madMultiplier: 8, hardFloorReturn: 0.005 },
    sek_exotic: { madMultiplier: 10, hardFloorReturn: 0.01 },
    xauusd: { madMultiplier: 10, hardFloorReturn: 0.01 },
    dxy_synthetic: { madMultiplier: 8, hardFloorReturn: 0.02 },
  },
  blockingAuthority: 'v3',
  v2: 'audit_only',
};

async function main() {
  const activate = process.argv.includes('--activate');
  const pool = new Pool({ host: process.env.TM_DB_HOST || 'localhost', port: +(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || 'tradzfx_v2', user: 'postgres', password: process.env.TM_DB_PASSWORD });
  try {
    if (activate) {
      await pool.query(`UPDATE market.detector_config SET status='retired', retired_at=now(), retired_by='freeze-detector-v3.js' WHERE status='active' AND detector_version <> $1`, [VERSION]);
    }
    await pool.query(`INSERT INTO market.detector_config (detector_version, status, config, created_by)
      VALUES ($1, $2, $3::jsonb, 'freeze-detector-v3.js')
      ON CONFLICT (detector_version) DO NOTHING`, [VERSION, activate ? 'active' : 'draft', JSON.stringify(CONFIG)]);
    if (activate) {
      await pool.query(`UPDATE market.detector_config SET status='active', activated_at=COALESCE(activated_at, now()), activated_by=COALESCE(activated_by, 'freeze-detector-v3.js') WHERE detector_version=$1`, [VERSION]);
      console.warn('v2 evidence remains audit-only by existing superseding migrations; no historical evidence rows modified.');
    }
    console.log(JSON.stringify({ detectorVersion: VERSION, status: activate ? 'active' : 'draft', config: CONFIG }, null, 2));
  } finally { await pool.end(); }
}
main().catch((err) => { console.error(err); process.exit(1); });
