'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = 'C:\\tradzfx-v2';
const OUT = 'C:\\Users\\Salman\\AppData\\Local\\Temp\\tradzfx-frozen-audit';
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env.local'), override: true, quiet: true });
const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const times = ['2026-07-07T21:04:00.000Z', '2026-07-07T21:05:00.000Z'];
const components = ['EURUSD','USDJPY','GBPUSD','USDCAD','USDSEK','USDCHF'];
const exponents = { EURUSD:-0.576, USDJPY:0.136, GBPUSD:-0.119, USDCAD:0.091, USDSEK:0.042, USDCHF:0.036 };
const constant = 50.14348112;
const sql = {
  components: `SELECT symbol, ts, o, h, l, c, v, spread, broker, digits FROM market.candles_1m_canonical WHERE symbol = ANY($1) AND ts = ANY($2::timestamptz[]) ORDER BY ts, symbol`,
  anomalies: `SELECT symbol, broker, event_time, flags, severity, detector_version, decision FROM candle_quarantine WHERE symbol = ANY($1) AND event_time = ANY($2::timestamptz[]) ORDER BY event_time, symbol, broker`,
  dxy: `SELECT symbol, ts, o, h, l, c, v, spread, broker, digits FROM market.candles_1m_canonical WHERE symbol='DXY' AND ts = ANY($1::timestamptz[]) ORDER BY ts`
};
function formula(rows, field) { let value = constant; for (const symbol of components) { const row = rows.find(r => r.symbol === symbol); if (!row || Number(row[field]) <= 0) return null; value *= Math.pow(Number(row[field]), exponents[symbol]); } return value; }
(async () => { const pool = new Pool({ host:process.env.TM_DB_HOST||'localhost', port:+(process.env.TM_DB_PORT||5432), database:process.env.TM_DB_NAME||'tradzfx_v2', user:process.env.TM_DB_USER||'postgres', password:process.env.TM_DB_PASSWORD, max:1 }); const c=await pool.connect(); try {
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot=(await c.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const componentRows=(await c.query(sql.components,[components,times])).rows;
  const anomalyRows=(await c.query(sql.anomalies,[['DXY',...components],times])).rows;
  const dxyRows=(await c.query(sql.dxy,[times])).rows;
  const evidence=times.map(ts=>{ const cr=componentRows.filter(r=>new Date(r.ts).toISOString()===ts); const d=dxyRows.find(r=>new Date(r.ts).toISOString()===ts)||null; const close=formula(cr,'c'); const open=formula(cr,'o'); const high=formula(cr,'h'); const low=formula(cr,'l'); const deviations=d&&close ? { close:Math.abs((Number(d.c)-close)/close), open:Math.abs((Number(d.o)-open)/open) } : null; return { timestamp:ts, components:cr, dxy:d, formula:{constant,exponents,open,high,low,close}, deviations, anomalies:anomalyRows.filter(r=>new Date(r.event_time).toISOString()===ts), decision:'UNKNOWN', decision_reason:'Component evidence captured; no policy decision made automatically.' }; });
  const report={schema:'dxy-residual-component-evidence-v1',status:'BLOCKED',authority:'NON_AUTHORITATIVE',snapshot:{id:snapshot,isolation:'REPEATABLE READ',read_only:true},code:{commit:require('child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim()},queries:Object.fromEntries(Object.entries(sql).map(([k,v])=>[k,sha256(v)])),policy:{constant,components,exponents},evidence,freeze_state:{PERMISSION:'INACTIVE',TECHNICAL_ELIGIBILITY:'BLOCKED_UNKNOWN',EXECUTION:'NO_SHADOW_RUN_YET',REPLAY:'NOT_PERFORMED',DB_WRITES:0,MIGRATION_193:'UNAPPLIED',ORDERS:'NONE'}};
  const file=path.join(OUT,'dxy-residual-component-evidence-2026-08-10.v1.json'); fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'}); await c.query('ROLLBACK'); console.log(JSON.stringify({file,status:report.status,authority:report.authority,timestamps:times,db_writes:0,rollback:true},null,2));
 } catch(e){await c.query('ROLLBACK').catch(()=>{}); throw e;} finally{c.release();await pool.end();}})().catch(e=>{console.error('EVIDENCE_FAILED:',e.message);process.exit(1)});
