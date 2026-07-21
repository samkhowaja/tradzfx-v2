/**
 * Invalidate zones in dead structural waves.
 *
 * Professional ICT/SMC rule:
 *   A zone belongs to its parent-TF structural wave.
 *   If parent-TF bias now opposes zone direction, zone is in a dead wave.
 *   → is_fresh=false, invalidated_at=NOW()
 *
 * Wave hierarchy:
 *   1m/5m/15m zones → 1h bias
 *   1h zones        → 4h bias
 *   4h zones        → 1d bias
 *   1d zones        → 1d bias
 *
 * Also applies to: features_order_block, features_ifvg
 */

const { Client } = require("pg");

const WAVE_MAP = [
  { zoneTfs: ["1m", "5m", "15m"], waveTf: "1h" },
  { zoneTfs: ["1h"], waveTf: "4h" },
  { zoneTfs: ["4h", "1d"], waveTf: "1d" },
];

// Each table may use a different column name for directional alignment
const TABLE_CONFIG = [
  { table: "features_zone", dirCol: "direction" },
  // order_block uses source_event_direction (the direction of the structural
  // event that formed the block, not the block's own direction)
  { table: "features_order_block", dirCol: "source_event_direction" },
  { table: "features_ifvg", dirCol: "direction" },
];
const DBS =
  process.env.DATABASE_URL ??
  "postgresql://postgres:2k16Dub@i@localhost:5432/tradzfx_v2";

async function invalidateDeadWaveZones(client) {
  let grandTotal = 0;

  for (const cfg of TABLE_CONFIG) {
    const { table, dirCol } = cfg;
    console.log(`\n[${table}] scanning (dirCol=${dirCol})...`);

    for (const rule of WAVE_MAP) {
      const zoneTfs = rule.zoneTfs;
      const waveTf = rule.waveTf;

      const sql = `
        WITH latest_bias AS (
          SELECT DISTINCT ON (symbol) symbol, direction, ts
          FROM features_bias
          WHERE tf = $1
            AND direction IN ('bullish', 'bearish')
          ORDER BY symbol, ts DESC
        )
        UPDATE ${table} z
        SET is_fresh = false,
            invalidated_at = NOW()
        FROM latest_bias lb
        WHERE z.symbol = lb.symbol
          AND z.tf = ANY($2::text[])
          AND z.is_fresh = true
          AND z.${dirCol} IS NOT NULL
          AND z.${dirCol} != lb.direction
      `;

      const res = await client.query(sql, [waveTf, zoneTfs]);
      if (res.rowCount > 0) {
        console.log(
          `  ${zoneTfs.join("/")} → ${waveTf}: ${res.rowCount} invalidated`
        );
        grandTotal += res.rowCount;
      }
    }
  }

  return grandTotal;
}

async function main() {
  const client = new Client({ connectionString: DBS });
  await client.connect();

  try {
    console.log("=== Wave-based zone invalidation ===\n");
    console.log(`Date: ${new Date().toISOString().slice(0, 10)}`);

    const total = await invalidateDeadWaveZones(client);
    console.log(`\nDone. Total invalidated: ${total}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
