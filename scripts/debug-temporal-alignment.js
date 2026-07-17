#!/usr/bin/env node
/**
 * P2-A: Temporal Alignment Visualizer
 *
 * Generates a self-contained HTML Gantt chart showing feature events across
 * time with session bands, gap markers, and intersection highlights.
 *
 * Usage:
 *   node scripts/debug-temporal-alignment.js XAUUSD 1h 2026-06-13 2026-07-13
 *   node scripts/debug-temporal-alignment.js XAUUSD 15m 2026-07-01 2026-07-13 --open
 *
 * Flags:
 *   --open     Open in default browser after generation
 *   --out=path Custom output path (default: /tmp/temporal-alignment.html)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
});

// ── helpers ──────────────────────────────────────────────────────────────────

const SESSION_WINDOWS = { ASIA: [0, 6], LONDON: [7, 11], OVERLAP: [12, 15], NY: [16, 20] };
const SESSION_COLORS = {
  ASIA: "rgba(255,200,87,0.12)",
  LONDON: "rgba(87,200,255,0.12)",
  OVERLAP: "rgba(200,87,255,0.12)",
  NY: "rgba(87,255,200,0.12)",
  OFF_HOURS: "rgba(0,0,0,0.0)",
};
const SESSION_BORDER = {
  ASIA: "rgba(255,200,87,0.3)",
  LONDON: "rgba(87,200,255,0.3)",
  OVERLAP: "rgba(200,87,255,0.3)",
  NY: "rgba(87,255,200,0.3)",
  OFF_HOURS: "transparent",
};

function getSession(h) {
  for (const [s, [lo, hi]] of Object.entries(SESSION_WINDOWS))
    if (h >= lo && h <= hi) return s;
  return "OFF_HOURS";
}

function fmt(d) {
  if (!d) return "";
  const dd = typeof d === "string" ? new Date(d) : d;
  return dd.toISOString().replace("T", " ").slice(0, 19);
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── query layers ─────────────────────────────────────────────────────────────

async function loadEvents(symbol, tf, start, end) {
  const layers = {};

  // Bias
  const biasRows = await pool.query(
    `SELECT ts, direction, confidence FROM features_bias WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 ORDER BY ts`,
    [symbol, tf, start, end]
  );
  layers.bias = biasRows.rows;

  // Direction state
  const dsRows = await pool.query(
    `SELECT ts, direction, regime, agreement FROM features_direction_state WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 ORDER BY ts`,
    [symbol, tf, start, end]
  );
  layers.direction_state = dsRows.rows;

  // Structure
  const structRows = await pool.query(
    `SELECT ts, event_type, direction, strength, invalidated_at FROM features_structure WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 ORDER BY ts`,
    [symbol, tf, start, end]
  );
  layers.structure = structRows.rows;

  // Zone
  const zoneRows = await pool.query(
    `SELECT ts, zone_kind, direction, strength_score, invalidated_at, mitigated_at FROM features_zone WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 ORDER BY ts`,
    [symbol, tf, start, end]
  );
  layers.zone = zoneRows.rows;

  // iFVG
  const ifvgRows = await pool.query(
    `SELECT ts, direction, strength_score, invalidated_at, mitigated_at FROM features_ifvg WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 ORDER BY ts`,
    [symbol, tf, start, end]
  );
  layers.ifvg = ifvgRows.rows;

  // Sweep
  const sweepRows = await pool.query(
    `SELECT ts, direction, sweep_type FROM features_sweep WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 ORDER BY ts`,
    [symbol, tf, start, end]
  );
  layers.sweep = sweepRows.rows;

  // Displacement
  const dispRows = await pool.query(
    `SELECT ts, direction, grade AS strength FROM features_displacement WHERE symbol=$1 AND tf=$2 AND ts>=$3 AND ts<=$4 ORDER BY ts`,
    [symbol, tf, start, end]
  );
  layers.displacement = dispRows.rows;

  return layers;
}

// ── HTML generation ──────────────────────────────────────────────────────────

function generateHTML(symbol, tf, start, end, layers) {
  const eventsJSON = JSON.stringify(layers);
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const rangeMs = endMs - startMs;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Temporal Alignment — ${symbol} ${tf} ${start} to ${end}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
h1 { font-size: 1.3rem; margin-bottom: 4px; color: #58a6ff; }
h2 { font-size: 0.9rem; font-weight: 400; color: #8b949e; margin-bottom: 16px; }
.legend { display: flex; flex-wrap: wrap; gap: 12px 24px; margin-bottom: 16px; font-size: 0.78rem; }
.legend-item { display: flex; align-items: center; gap: 5px; }
.legend-swatch { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }
.legend-swatch.bull { background: #26a69a; }
.legend-swatch.bear { background: #ef5350; }
.legend-swatch.neutral { background: #78909c; }
.legend-swatch.session { background: rgba(87,200,255,0.2); border: 1px solid rgba(87,200,255,0.3); }
#chart { position: relative; overflow-x: auto; }
canvas { display: block; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px,1fr)); gap: 8px; margin-bottom: 20px; }
.stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px 12px; }
.stat-card .label { font-size: 0.7rem; color: #8b949e; text-transform: uppercase; }
.stat-card .value { font-size: 1.1rem; font-weight: 600; margin-top: 2px; }
.stat-card .value.bull { color: #26a69a; }
.stat-card .value.bear { color: #ef5350; }
.tooltip { position: fixed; background: #1c2333; border: 1px solid #30363d; border-radius: 6px; padding: 8px 12px; font-size: 0.75rem; max-width: 360px; pointer-events: none; z-index: 100; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
.tooltip .tt-row { margin: 2px 0; }
.tooltip .tt-time { color: #58a6ff; }
.legend-bracket { display: flex; align-items: center; gap: 5px; }
.legend-bracket-line { width: 20px; height: 0; border-top: 2px solid; }
</style>
</head>
<body>
<h1>${esc(symbol)} @ ${esc(tf)} &mdash; Temporal Alignment</h1>
<h2>${esc(start)} &ndash; ${esc(end)} &bull; ${esc(rangeMs/(86400000))} days</h2>

<div class="legend">
  <span class="legend-item"><span class="legend-swatch bull"></span> Bullish</span>
  <span class="legend-item"><span class="legend-swatch bear"></span> Bearish</span>
  <span class="legend-item"><span class="legend-swatch neutral"></span> Neutral/Other</span>
  <span class="legend-item"><span class="legend-swatch session"></span> Session (ASIA/LONDON/OVERLAP/NY)</span>
</div>

<div class="stats" id="stats"></div>
<div id="chart"><canvas id="gantt"></canvas></div>
<div class="tooltip" id="tooltip"></div>

<script>
const EVENTS = ${eventsJSON};
const SYMBOL = ${JSON.stringify(symbol)};
const TF = ${JSON.stringify(tf)};
const START = ${startMs};
const END = ${endMs};
const RANGE_MS = END - START;

// Session config
const SESSIONS = ${JSON.stringify(SESSION_WINDOWS)};
const SESSION_COLORS = ${JSON.stringify(SESSION_COLORS)};
const SESSION_BORDER = ${JSON.stringify(SESSION_BORDER)};

// ── canvas setup ──
const W = Math.max(1200, RANGE_MS / 60000 * 0.3);
const ROW_H = 24;
const PAD_LEFT = 130;
const PAD_TOP = 20;
const X0 = PAD_LEFT;
const Y0 = PAD_TOP;

const layers = [
  { key: 'bias', label: 'Bias', color: '#42a5f5' },
  { key: 'direction_state', label: 'Direction State', color: '#7e57c2' },
  { key: 'structure', label: 'Structure', color: '#ffa726' },
  { key: 'zone', label: 'Zone', color: '#66bb6a' },
  { key: 'ifvg', label: 'iFVG', color: '#ef5350' },
  { key: 'sweep', label: 'Sweep', color: '#ec407a' },
  { key: 'displacement', label: 'Displacement', color: '#8d6e63' },
];

const H = PAD_TOP + layers.length * ROW_H + 40;

function pos(ts) {
  return X0 + ((new Date(ts).getTime() - START) / RANGE_MS) * (W - PAD_LEFT - 20);
}

// ── render sessions ──
function drawSessions(ctx) {
  const days = Math.ceil(RANGE_MS / 86400000);
  for (let d = 0; d < days; d++) {
    const dayStart = START + d * 86400000;
    for (let h = 0; h < 24; h++) {
      const sess = getSession(h);
      if (sess === 'OFF_HOURS') continue;
      const x1 = pos(dayStart + h * 3600000);
      const x2 = pos(dayStart + (h + 1) * 3600000);
      ctx.fillStyle = SESSION_COLORS[sess];
      ctx.fillRect(x1, PAD_TOP - 12, x2 - x1, H - PAD_TOP + 12);
    }
  }
  // Hour lines
  ctx.strokeStyle = 'rgba(48,54,61,0.3)';
  ctx.lineWidth = 0.5;
  for (let d = 0; d < days; d++) {
    const dayStart = START + d * 86400000;
    for (let h = 0; h <= 24; h++) {
      const x = pos(dayStart + h * 3600000);
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP - 12);
      ctx.lineTo(x, H - 10);
      ctx.stroke();
    }
  }
}

function getSession(h) {
  for (const [s, [lo, hi]] of Object.entries(SESSIONS))
    if (h >= lo && h <= hi) return s;
  return 'OFF_HOURS';
}

// ── render events ──
function drawLayer(ctx, layer, idx) {
  const y = Y0 + idx * ROW_H;
  const events = EVENTS[layer.key] || [];

  // Label
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(layer.label, X0 - 8, y + ROW_H / 2 + 4);

  // Row bg
  ctx.fillStyle = idx % 2 === 0 ? 'rgba(22,27,34,0.3)' : 'rgba(22,27,34,0.1)';
  ctx.fillRect(X0, y, W - X0 - 20, ROW_H);

  for (const ev of events) {
    const x = pos(ev.ts);
    const isBull = ev.direction === 'bullish';
    const isBear = ev.direction === 'bearish';
    const color = isBull ? '#26a69a' : isBear ? '#ef5350' : '#78909c';
    const alpha = layer.key === 'bias' || layer.key === 'direction_state' ? 0.7 : 0.9;

    // Dot or bar based on type
    if (layer.key === 'bias' || layer.key === 'direction_state') {
      // State features: filled circle
      ctx.beginPath();
      ctx.arc(x, y + ROW_H / 2, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // Event features: vertical line
      ctx.beginPath();
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x, y + ROW_H - 3);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Active window markers (for zone/ifvg/ob with lifecycle)
      if (ev.invalidated_at || ev.mitigated_at) {
        const invX = ev.invalidated_at ? pos(ev.invalidated_at) : x + 20;
        const mitX = ev.mitigated_at ? pos(ev.mitigated_at) : null;
        const rightX = mitX !== null ? Math.min(invX, mitX) : invX;
        if (rightX > x + 2) {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.12;
          ctx.fillRect(x, y + 8, rightX - x, ROW_H - 16);
          ctx.globalAlpha = 1;
        }
      }
    }

    // Strength indicator
    if (ev.strength !== undefined && ev.strength !== null) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.6;
      ctx.fillText(ev.strength, x, y + ROW_H - 2);
      ctx.globalAlpha = 1;
    }
  }
}

// ── stats ──
function computeStats() {
  const cards = [];
  for (const layer of layers) {
    const ev = EVENTS[layer.key] || [];
    const bull = ev.filter(e => e.direction === 'bullish').length;
    const bear = ev.filter(e => e.direction === 'bearish').length;
    const other = ev.length - bull - bear;
    cards.push({ label: layer.label, total: ev.length, bull, bear, other });
  }
  return cards;
}

function renderStats() {
  const el = document.getElementById('stats');
  const cards = computeStats();
  el.innerHTML = cards.map(c => \`
    <div class="stat-card">
      <div class="label">\${c.label}</div>
      <div class="value" style="display:flex;gap:8px;">
        <span style="color:#8b949e">\${c.total}</span>
        <span class="bull">\${c.bull}▲</span>
        <span class="bear">\${c.bear}▼</span>
      </div>
    </div>
  \`).join('');
}

// ── main ──
function main() {
  const canvas = document.getElementById('gantt');
  if (!canvas) return;
  canvas.width = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);

  // Dark bg
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  drawSessions(ctx);
  for (let i = 0; i < layers.length; i++) {
    drawLayer(ctx, layers[i], i);
  }

  // X axis labels
  ctx.fillStyle = '#484f58';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const days = Math.ceil(RANGE_MS / 86400000);
  for (let d = 0; d <= days; d++) {
    const dt = new Date(START + d * 86400000);
    const x = pos(dt);
    ctx.fillText(dt.toISOString().slice(0,10), x, H - 2);
  }

  renderStats();

  // ── tooltip (wired after canvas exists) ──
  const tooltip = document.getElementById('tooltip');

  function getEventsAt(x) {
    const ts = new Date(START + ((x - X0) / (W - X0 - 20)) * RANGE_MS);
    const results = [];
    for (const layer of layers) {
      const evs = EVENTS[layer.key] || [];
      for (const ev of evs) {
        const dt = Math.abs(new Date(ev.ts).getTime() - ts.getTime());
        if (dt < RANGE_MS * 0.003) {
          results.push({ layer: layer.label, ...ev });
        }
      }
    }
    return { ts, events: results.slice(0, 15) };
  }

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < X0 || x > W - 20) { tooltip.style.display = 'none'; return; }
    const { ts, events } = getEventsAt(x);
    if (events.length === 0) { tooltip.style.display = 'none'; return; }
    tooltip.innerHTML = \`
      <div class="tt-row tt-time">\${ts.toISOString().slice(0,19).replace('T',' ')}</div>
      \${events.map(e => \`<div class="tt-row" style="color:\${e.direction==='bullish'?'#26a69a':e.direction==='bearish'?'#ef5350':'#78909c'}">\${e.layer} \${e.direction||''} \${e.event_type||''} \${e.strength_score||e.strength||''}</div>\`).join('')}
    \`.trim();
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY - 10) + 'px';
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
}

main();
</script>
</body>
</html>`;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const symbol = args[0] || "XAUUSD";
  const tf = args[1] || "1h";
  const start = args[2] || "2026-07-01";
  const end = args[3] || "2026-07-13";
  const openFlag = args.includes("--open");
  const outArg = args.find((a) => a.startsWith("--out="));
  const outPath = outArg ? outArg.slice(6) : path.join(require("os").tmpdir(), "temporal-alignment.html");

  console.log(`Loading events: ${symbol} ${tf} ${start} → ${end} ...`);
  const layers = await loadEvents(symbol, tf, start, end);

  const totalEvents = Object.values(layers).reduce((s, arr) => s + arr.length, 0);
  console.log(`Loaded ${totalEvents} events across ${Object.keys(layers).length} layers`);

  const html = generateHTML(symbol, tf, start, end, layers);
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`Written: ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);

  if (openFlag) {
    try {
      execSync(`start "" "${outPath}"`, { shell: true });
      console.log("Opened in browser");
    } catch {
      console.log("Could not auto-open; open manually");
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
