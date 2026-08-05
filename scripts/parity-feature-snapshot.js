// Parity harness: snapshot feature rows over a window, diff two snapshots.
// Usage:
//   node scripts/parity-feature-snapshot.js snapshot <label>
//   node scripts/parity-feature-snapshot.js diff <labelA> <labelB>
// Cell selection via env (defaults = EURUSD 5m window 48 cert cell):
//   PARITY_SYMBOL, PARITY_TF, PARITY_FROM, PARITY_TO
// Snapshot labels are namespaced by symbol+tf so cells never collide:
//   <label> becomes <SYMBOL>_<TF>__<label> on disk.
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const SYMBOL = process.env.PARITY_SYMBOL || "EURUSD";
const TF = process.env.PARITY_TF || "5m";
// Default window 48 range. Feature rows are keyed at anchor - tf, so the last
// row is 2026-08-04T07:45Z (last anchor 07:50 consumes through 07:45).
// GBPUSD 5m cell (trusted window 59): PARITY_SYMBOL=GBPUSD
//   PARITY_FROM=2026-07-18T01:43:00Z PARITY_TO=2026-08-04T07:54:00Z
const FROM = process.env.PARITY_FROM || "2026-07-18T01:40:00Z";
const TO = process.env.PARITY_TO || "2026-08-04T07:53:00Z";
const FEATURES = [
  "features_moving_average",
  "features_atr",
  "features_pivot",
  "features_structure",
];

const CELL_OVERRIDDEN = !!(process.env.PARITY_SYMBOL || process.env.PARITY_TF || process.env.PARITY_FROM || process.env.PARITY_TO);

function cellLabel(label) {
  // Namespace only when the cell is overridden via env, so the existing
  // EURUSD window-48 snapshots (runA/runB/runC) stay addressable.
  return CELL_OVERRIDDEN ? `${SYMBOL}_${TF}__${label}` : label;
}

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
});

// Canonical serialization: sort keys, render numbers with full precision,
// nulls explicit. Same shape as immutable-run-store canonicalJson but local
// to keep this harness self-contained.
function canon(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    return v;
  }
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}

function rowHash(row) {
  return crypto.createHash("sha256").update(JSON.stringify(canon(row))).digest("hex");
}

// Columns that legitimately change between identical reruns (persist
// wall-clock, run lineage). Parity applies to computed values + keys, not to
// when the row was written.
const VOLATILE_COLS = new Set(["generated_at", "created_at", "updated_at"]);

async function snapshot(label) {
  label = cellLabel(label);
  const outDir = path.resolve(__dirname, "..", "reports", "parity");
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = { symbol: SYMBOL, tf: TF, from: FROM, to: TO, takenAt: new Date().toISOString(), features: {} };

  for (const feature of FEATURES) {
    const { rows } = await pool.query(
      `SELECT * FROM public.${feature}
       WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4
       ORDER BY ts`,
      [SYMBOL, TF, FROM, TO]
    );
    // Strip volatile cols, then sort serialized rows fully so the snapshot is
    // order-independent (multi-row-per-anchor features share ts).
    const serialized = rows.map((r) => {
      const clean = {};
      for (const k of Object.keys(r)) if (!VOLATILE_COLS.has(k)) clean[k] = r[k];
      return JSON.stringify(canon(clean));
    }).sort();
    const hasher = crypto.createHash("sha256");
    for (const s of serialized) hasher.update(s).update("\n");
    const keySet = new Map(); // ts -> count
    for (const r of rows) {
      const k = new Date(r.ts).toISOString();
      keySet.set(k, (keySet.get(k) || 0) + 1);
    }
    const file = path.join(outDir, `${label}__${feature}.jsonl`);
    fs.writeFileSync(file, serialized.join("\n") + "\n");
    manifest.features[feature] = {
      rows: rows.length,
      distinctAnchors: keySet.size,
      minTs: rows.length ? new Date(rows[0].ts).toISOString() : null,
      maxTs: rows.length ? new Date(rows[rows.length - 1].ts).toISOString() : null,
      setHash: hasher.digest("hex"),
      file: path.relative(process.cwd(), file),
    };
    console.log(`[snapshot] ${feature}: rows=${rows.length} anchors=${keySet.size} hash=${manifest.features[feature].setHash.slice(0, 16)}`);
  }
  const mFile = path.join(outDir, `${label}__manifest.json`);
  fs.writeFileSync(mFile, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`[snapshot] manifest: ${path.relative(process.cwd(), mFile)}`);
}

async function diff(labelA, labelB) {
  labelA = cellLabel(labelA);
  labelB = cellLabel(labelB);
  const outDir = path.resolve(__dirname, "..", "reports", "parity");
  let fail = 0;
  for (const feature of FEATURES) {
    const fa = path.join(outDir, `${labelA}__${feature}.jsonl`);
    const fb = path.join(outDir, `${labelB}__${feature}.jsonl`);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) {
      console.error(`[diff] ${feature}: missing snapshot file`); fail++; continue;
    }
    const A = fs.readFileSync(fa, "utf8").trimEnd().split("\n");
    const B = fs.readFileSync(fb, "utf8").trimEnd().split("\n");
    const countA = new Map(); for (const s of A) countA.set(s, (countA.get(s) || 0) + 1);
    const countB = new Map(); for (const s of B) countB.set(s, (countB.get(s) || 0) + 1);
    let missing = 0, extra = 0;
    for (const [s, n] of countA) {
      const m = countB.get(s) || 0;
      if (m < n) {
        missing += n - m;
        if (missing <= 3) console.error(`[diff] ${feature} MISSING in ${labelB}: ${s.slice(0, 200)}`);
      }
    }
    for (const [s, n] of countB) {
      const m = countA.get(s) || 0;
      if (m < n) {
        extra += n - m;
        if (extra <= 3) console.error(`[diff] ${feature} EXTRA in ${labelB}: ${s.slice(0, 200)}`);
      }
    }
    const ok = missing === 0 && extra === 0;
    if (!ok) fail++;
    console.log(`[diff] ${feature}: ${labelA}=${A.length} ${labelB}=${B.length} missing=${missing} extra=${extra} ${ok ? "PARITY_OK" : "PARITY_FAIL"}`);
  }
  console.log(fail === 0 ? "[diff] OVERALL: PARITY_OK" : `[diff] OVERALL: PARITY_FAIL (${fail} features)`);
  process.exitCode = fail === 0 ? 0 : 1;
}

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === "snapshot") await snapshot(a);
    else if (cmd === "diff") await diff(a, b);
    else { console.error("usage: snapshot <label> | diff <a> <b>"); process.exitCode = 2; }
  } finally {
    await pool.end();
  }
})();
