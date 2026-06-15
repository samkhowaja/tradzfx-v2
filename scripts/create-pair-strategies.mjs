import pg from 'pg';

const pool = new pg.Pool({ host: 'localhost', port: 5432, database: 'tradementor_v2', user: 'postgres', password: '2k16Dub@i' });

// Optimization results from pair-backtest-pit.js --optimize
// Format: [symbol, slMult, tpRatio, timeoutBars, expectedWR, expectedNetR, notes]
const pairConfigs = [
  { symbol: 'EURUSD',  slMult: 0.8, tpRatio: 4.0, timeout: 180, wr: 42.9, netR: 8.00,  notes: 'Low signal density, small sample — conservative' },
  { symbol: 'GBPUSD',  slMult: 0.8, tpRatio: 3.0, timeout: 240, wr: 54.0, netR: 287.2, notes: 'High frequency — 3R balances WR and netR' },
  { symbol: 'AUDUSD',  slMult: 0.8, tpRatio: 4.0, timeout: 120, wr: 63.4, netR: 157.3, notes: 'Strong performer, tight timeout for faster turnover' },
  { symbol: 'NZDUSD',  slMult: 0.8, tpRatio: 4.0, timeout: 240, wr: 55.0, netR: 115.4, notes: 'Good edge with 4R' },
  { symbol: 'USDCAD',  slMult: 0.8, tpRatio: 3.0, timeout: 180, wr: 71.0, netR: 127.0, notes: 'Highest WR at 3R — stable' },
  { symbol: 'USDCHF',  slMult: 0.8, tpRatio: 4.0, timeout: 120, wr: 63.0, netR: 222.2, notes: 'Excellent with 4R' },
  { symbol: 'USDJPY',  slMult: 0.8, tpRatio: 4.0, timeout: 180, wr: 63.4, netR: 274.1, notes: 'Top performer, heavy short bias' },
  { symbol: 'XAUUSD',  slMult: 0.8, tpRatio: 4.0, timeout: 240, wr: 48.2, netR: 199.8, notes: 'Volatile — needs wider timeout' },
];

async function main() {
  // Load base waqar_v2 spec
  const { rows } = await pool.query("SELECT spec_json FROM strategy_specs WHERE id = 'waqar_v2'");
  if (rows.length === 0) throw new Error('waqar_v2 not found');
  const baseSpec = rows[0].spec_json;

  for (const cfg of pairConfigs) {
    const specId = `waqar_v2_${cfg.symbol.toLowerCase()}`;
    const spec = JSON.parse(JSON.stringify(baseSpec));

    spec.id = specId;
    spec.name = `Waqar V2 — ${cfg.symbol}`;
    spec.version = '2.1.0';
    spec.description = `Pair-optimized waqar_v2 for ${cfg.symbol}. SL=${cfg.slMult}xATR, TP=${cfg.tpRatio}R. ${cfg.notes}`;
    spec.filters.symbols = [cfg.symbol];

    // Override risk
    spec.risk.sl = `atr(1m) * ${cfg.slMult}`;
    spec.risk.tp = `sl * ${cfg.tpRatio}`;
    spec.risk.timeoutBars = cfg.timeout;

    // Override live config
    spec.live.mode = 'paper';
    spec.live.cooldownMinutes = 60; // 1h cooldown to prevent overtrading
    spec.live.maxPositionsPerSymbol = 1;
    spec.live.maxPositionsTotal = 3;
    spec.live.structureFreshnessMinutes = 30;

    // Insert or update
    await pool.query(`
      INSERT INTO strategy_specs (id, name, version, description, spec_json, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        version = EXCLUDED.version,
        description = EXCLUDED.description,
        spec_json = EXCLUDED.spec_json,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `, [specId, spec.name, spec.version, spec.description, JSON.stringify(spec)]);

    console.log(`✅ Created strategy: ${specId} | ${cfg.symbol} | SL=${cfg.slMult}x | TP=${cfg.tpRatio}R | Timeout=${cfg.timeout} | Est WR=${cfg.wr}% | Est NetR=${cfg.netR}`);
  }

  await pool.end();
  console.log('\n🎯 All pair-specific strategies created. Set is_active=true to use in live trading.');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
