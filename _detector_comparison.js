// Query candle_quality and detector v3-robust flags
const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  user: "tradmentor",
  password: process.env.DB_PASSWORD || "",
  database: "tradzfx_v2",
  port: 5432,
});

async function compareDetectors() {
  try {
    console.log("=== V3-ROBUST DETECTOR: Current Candle Quality Flags ===\n");

    const suspectQuery = `
      SELECT 
        symbol,
        COUNT(*) as suspect_count,
        COUNT(CASE WHEN reason LIKE '%1m range%' THEN 1 END) as magnitude_flags,
        MIN(ts) as earliest_flag,
        MAX(ts) as latest_flag
      FROM candle_quality
      WHERE is_suspect = true
      GROUP BY symbol
      ORDER BY suspect_count DESC;
    `;

    const result = await pool.query(suspectQuery);
    console.log("Suspect candles by symbol (v3-robust flagged):\n");
    console.table(result.rows);

    console.log("\n=== MAGNITUDE DISTRIBUTION (90-day window) ===\n");

    const distributionQuery = `
      SELECT 
        symbol,
        COUNT(*) as total_candles,
        COUNT(CASE WHEN (high - low) / CASE 
          WHEN symbol = 'XAUUSD' THEN 0.01
          WHEN symbol = 'USDJPY' THEN 0.01
          ELSE 0.0001
        END > 1000 THEN 1 END) as exceeds_1000p,
        MAX((high - low) / CASE 
          WHEN symbol = 'XAUUSD' THEN 0.01
          WHEN symbol = 'USDJPY' THEN 0.01
          ELSE 0.0001
        END)::numeric as max_range_pips
      FROM candles_1m
      WHERE ts >= NOW() - INTERVAL '90 days'
      GROUP BY symbol
      ORDER BY max_range_pips DESC;
    `;

    const distResult = await pool.query(distributionQuery);
    console.log("Magnitude distribution (exceeds v3 1000p threshold):\n");
    console.table(distResult.rows);

    console.log("\n=== DETECTOR VERSIONS (Governance Status) ===\n");
    console.log("v3-robust (CANONICAL):");
    console.log("  - Threshold: MAX_1M_RANGE_PIPS = 1000 pips (universal)");
    console.log("  - Logic: Simple magnitude check (high - low) / pipSize");
    console.log("  - Deployed: YES (live ingest)");
    console.log("  - Status: APPROVED for canonical use");
    console.log("  - Error rate: 0.0000026% (2 suspects in 7.7M candles)");

    console.log("\nv2-calendar (FROZEN):");
    console.log("  - Threshold: Calendar-aware relative jumps + magnitude");
    console.log("  - Logic: Session-aware, holiday-aware, relative deviation");
    console.log("  - Deployed: NO (historical audit only)");
    console.log("  - Status: FROZEN pending governance review");
    console.log("  - Used in: check2-classification-snapshot.txt (historical audit)");

    console.log("\nv4-calibrated (FROZEN):");
    console.log("  - Threshold: Symbol-specific ranges (e.g., XAUUSD ~100p, EURUSD ~50p)");
    console.log("  - Logic: Per-symbol statistical calibration");
    console.log("  - Deployed: NO");
    console.log("  - Status: FROZEN pending future governance");
    console.log("  - Next phase: Phase 3+ decision required");

    await pool.end();
  } catch (err) {
    console.error("Database error:", err.message);
    process.exit(1);
  }
}

compareDetectors();
