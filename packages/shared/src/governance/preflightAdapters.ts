import type { Queryable } from "../utils/db";
import type { CandidateContext, PreflightCheck, PreflightChecks } from "./preflightEvaluator";
import { expectedTradableBars, inBreakEdgeWindow, isTradableInstant, tradableBarStarts } from "../utils/marketCalendar";
import type { TimeFrame } from "../types/feature";

type Row = Record<string, unknown>;

/**
 * 1m source slots an HTF anchor is expected to cover for certification.
 * A slot is expected only when the market is open per the FX 24/5 calendar
 * AND outside the broker break-edge halt/resume window (the feed never sends
 * those minutes, so their absence is expected closure, not a missing bar).
 * Fail-closed: any expected slot absent from the canonical 1m source set is a
 * genuine missing bar and blocks the anchor.
 */
export function expectedHtfSourceSlots(anchor: string, sourceBarsPerHtf: number, symbol?: string): string[] {
  return Array.from({ length: sourceBarsPerHtf }, (_, i) => new Date(new Date(anchor).getTime() + i * 60_000))
    .filter((slot) => isTradableInstant(slot, symbol) && !inBreakEdgeWindow(slot, symbol))
    .map((slot) => slot.toISOString());
}

export function validateHtfAnchors(
  expectedAnchors: readonly string[],
  htfAnchors: readonly string[],
  sourceAnchorsByHtf: ReadonlyMap<string, readonly string[]>,
  sourceBarsPerHtf: number,
  symbol?: string,
) {
  const htf = new Set(htfAnchors);
  let missingHtf = 0;
  const expected = new Set(expectedAnchors);
  const extraHtf = htfAnchors.filter((anchor) => !expected.has(anchor)).length;
  let incompleteSource = 0;
  for (const anchor of expectedAnchors) {
    if (!htf.has(anchor)) { missingHtf++; continue; }
    const source = sourceAnchorsByHtf.get(anchor) ?? [];
    const expectedSlots = expectedHtfSourceSlots(anchor, sourceBarsPerHtf, symbol);
    if (expectedSlots.some((ts) => !source.includes(ts))) incompleteSource++;
  }
  return {
    missingHtf,
    incompleteSource,
    extraHtf,
    closedBarChecked: missingHtf === 0 && extraHtf === 0 && incompleteSource === 0,
  };
}

export function normalizeAnchor(value: unknown): string {
  return new Date(String(value)).toISOString();
}

export function buildHtfAnchorMaps(rows: readonly Row[]) {
  const htfAnchors: string[] = [];
  const sources = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const htf = normalizeAnchor(row.htf_anchor ?? row.anchor_ts);
    const source = normalizeAnchor(row.source_ts);
    const identity = `${htf}|${source}|${String(row.source_key ?? "")}`;
    if (seen.has(identity)) throw new Error(`duplicate canonical source timestamp: ${source}`);
    seen.add(identity);
    if (!htfAnchors.includes(htf)) htfAnchors.push(htf);
    const list = sources.get(htf) ?? [];
    if (list.includes(source)) throw new Error(`duplicate canonical source timestamp: ${source}`);
    list.push(source);
    sources.set(htf, list);
  }
  return { htfAnchors, sources };
}

export function findFirstIncompleteHtfAnchor(
  expectedAnchors: readonly string[],
  sourceAnchorsByHtf: ReadonlyMap<string, readonly string[]>,
  sourceBarsPerHtf: number,
  symbol?: string,
): string | null {
  return expectedAnchors.find((anchor) => {
    const sources = sourceAnchorsByHtf.get(anchor) ?? [];
    const expectedSlots = expectedHtfSourceSlots(anchor, sourceBarsPerHtf, symbol);
    return expectedSlots.some((ts) => !sources.includes(ts));
  }) ?? null;
}

export function diagnoseHtfSourceWindow(
  anchor: string,
  sources: readonly string[],
  sourceBarsPerHtf: number,
  symbol?: string,
) {
  const expectedSlots = expectedHtfSourceSlots(anchor, sourceBarsPerHtf, symbol);
  const present = [...sources].sort();
  const missing = expectedSlots.filter((ts) => !sources.includes(ts));
  return {
    anchor,
    expectedCount: expectedSlots.length,
    actualCount: sources.length,
    firstMissingSource: missing[0] ?? null,
    lastPresentSource: present.at(-1) ?? null,
  };
}

function evidence(ctx: CandidateContext, details: unknown) {
  return {
    strategy: ctx.strategyId,
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    requiredBars: Number(ctx.maxLookbackBars ?? 0),
    effectiveBroker: String(ctx.effectiveBroker ?? "unknown"),
    dxyRequired: Boolean(ctx.requiresDxy),
    requestedWindow: { from: ctx.fromTs, to: ctx.toTs },
    details,
  };
}

async function expandedWindow(db: Queryable, ctx: CandidateContext): Promise<{ from: string; to: string; barsCovered: number }> {
  const bars = Math.max(0, Number(ctx.maxLookbackBars ?? 0));
  const row = await selectOne(db, `
    SELECT MIN(ts) AS expanded_from, COUNT(*)::int AS bars_covered
    FROM (
      SELECT ts
      FROM market.candles_1m_canonical
      WHERE symbol = $1 AND ts < $2
      ORDER BY ts DESC
      LIMIT $3
    ) covered`, [ctx.symbol, ctx.fromTs, Math.max(1, bars * 60)]);
  return {
    from: row?.expanded_from ? new Date(String(row.expanded_from)).toISOString() : ctx.fromTs,
    to: ctx.toTs,
    barsCovered: Number(row?.bars_covered ?? 0),
  };
}

async function selectOne(db: Queryable, text: string, values: unknown[]): Promise<Row | undefined> {
  const result = await db.query(text, values);
  return result.rows[0] as Row | undefined;
}

function timeframeMinutes(tf: string): number {
  const match = /^(\d+)(m|h|d)$/.exec(tf);
  if (!match) return 0;
  const n = Number(match[1]);
  return match[2] === "m" ? n : match[2] === "h" ? n * 60 : n * 1440;
}

async function canonicalTimeframeReports(db: Queryable, ctx: CandidateContext, window: { from: string; to: string }) {
  const dependencies = Array.isArray(ctx.dependencies) ? ctx.dependencies as Array<Record<string, unknown>> : [];
  const timeframes = new Set(["1m", ...dependencies.map((d) => String(d.timeframe ?? "")).filter(Boolean)]);
  const targetWindow = { from: ctx.fromTs, to: ctx.toTs };
  const reports: Array<Record<string, unknown>> = [];
  for (const tf of [...timeframes].sort()) {
    const canonicalTableByTimeframe: Record<string, string> = {
      "1m": "market.candles_1m_canonical",
      "5m": "market.candles_5m_canonical",
      "15m": "market.candles_15m_canonical",
      "1h": "market.candles_1h_canonical",
      "4h": "market.candles_4h_canonical",
      "1d": "market.candles_1d_utc_canonical",
    };
    const table = canonicalTableByTimeframe[tf];
    if (!table) {
      reports.push({ timeframe: tf, status: "BLOCKED_UNKNOWN", reason: "unsupported canonical timeframe table" });
      continue;
    }
    try {
      const expectedBars = expectedTradableBars(tf as TimeFrame, new Date(targetWindow.from), new Date(targetWindow.to), ctx.symbol);
      const intervalMinutes = timeframeMinutes(tf);
      const sourceFromMs = new Date(targetWindow.from).getTime();
      const alignedFromMs = Math.ceil(sourceFromMs / (intervalMinutes * 60_000)) * intervalMinutes * 60_000;
      const windowToMs = new Date(targetWindow.to).getTime();
      const expectedAnchors = tradableBarStarts(tf as TimeFrame, new Date(targetWindow.from), new Date(targetWindow.to), ctx.symbol)
        .map((value) => normalizeAnchor(value))
        .filter((anchor) => {
          const ts = new Date(anchor).getTime();
          return ts >= alignedFromMs && ts < windowToMs;
        });
      // NOTE: candle_eligibility is 1m-only; HTF blocked_bars is always 0 (dead metric).
      // HTF blocked source rows are computed below from the raw 1m-join subquery.
      const row = await selectOne(db, `SELECT COUNT(*)::int AS present_bars, MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts, COUNT(*) FILTER (WHERE e.state IN ('BLOCKED','ERROR'))::int AS blocked_bars FROM ${table} c LEFT JOIN market.candle_eligibility e ON e.symbol=c.symbol AND e.ts=c.ts AND e.timeframe='${tf}' WHERE c.symbol=$1 AND c.ts >= $2 AND c.ts < $3`, [ctx.symbol, targetWindow.from, targetWindow.to]);
      const present = Number(row?.present_bars ?? 0);
      // Only 1m has eligibility rows; for HTF this is always 0. Kept for schema symmetry.
      const blocked = tf === "1m" ? Number(row?.blocked_bars ?? 0) : 0;
      let closureFailures = 0;
      let anchorValidation: Record<string, unknown> = { closedBarChecked: tf === "1m" };
      const persisted = await db.query(`SELECT ts FROM ${table} WHERE symbol = $1 AND ts >= $2 AND ts < $3 ORDER BY ts`, [ctx.symbol, targetWindow.from, targetWindow.to]);
      const persistedAnchors = persisted.rows
        .map((item) => (item as Row).ts)
        .filter((value): value is string | Date => value != null)
        .map((value) => normalizeAnchor(value));
      const expectedSet = new Set(expectedAnchors);
      const persistedSet = new Set(persistedAnchors);
      const firstMissingAnchor = expectedAnchors.find((anchor) => !persistedSet.has(anchor)) ?? null;
      const firstExtraAnchor = persistedAnchors.find((anchor) => !expectedSet.has(anchor)) ?? null;
      const anchorDiagnosis: Record<string, unknown> = {
        interval: { from: targetWindow.from, to: targetWindow.to, semantics: "[from,to)" },
        expected: { count: expectedAnchors.length, first: expectedAnchors[0] ?? null, last: expectedAnchors.at(-1) ?? null },
        persisted: { count: persistedAnchors.length, first: persistedAnchors[0] ?? null, last: persistedAnchors.at(-1) ?? null },
        firstMissingAnchor,
        firstExtraAnchor,
      };
      if (tf !== "1m") {
        const minutes = timeframeMinutes(tf);
        const raw = await db.query(`
          SELECT h.ts AS htf_anchor, m.ts AS source_ts,
                 m.broker, l.source_key, l.lineage_id,
                 COALESCE(e.state, 'MISSING') AS eligibility_state
          FROM ${table} h
          LEFT JOIN market.candles_1m_canonical m
            ON m.symbol = h.symbol
           AND m.ts >= h.ts
           AND m.ts < h.ts + (${minutes} * interval '1 minute')
          LEFT JOIN market.candle_producer_lineage l
            ON l.symbol = m.symbol AND l.candle_ts = m.ts
           AND l.broker = m.broker
          LEFT JOIN market.candle_eligibility e
            ON e.symbol = m.symbol AND e.broker = m.broker
           AND e.timeframe = '1m' AND e.ts = m.ts
          WHERE h.symbol = $1 AND h.ts >= $2 AND h.ts < $3
          ORDER BY h.ts, m.ts, l.lineage_id`,
        [ctx.symbol, targetWindow.from, targetWindow.to]);
        const rawRows = raw.rows as Row[];
        const anchorMaps = buildHtfAnchorMaps(rawRows.filter((r) => r.source_ts != null).map((r) => ({
          ...r,
          source_key: `${String(r.source_key ?? "MISSING")}|${String(r.lineage_id ?? "MISSING")}`,
        })));
        const expectedAnchorSet = new Set(expectedAnchors);
        const canonicalHtfAnchors = anchorMaps.htfAnchors.filter((anchor) => expectedAnchorSet.has(anchor));
        const canonicalSources = new Map(
          [...anchorMaps.sources.entries()].filter(([anchor]) => expectedAnchorSet.has(anchor)),
        );
        const validation = validateHtfAnchors(expectedAnchors, canonicalHtfAnchors, canonicalSources, minutes, ctx.symbol);
        // MISSING with a non-null source_ts = a present canonical 1m bar with no
        // eligibility row (unevaluated) — always a blocker. Absent slots (no row at
        // all) don't appear here; they're handled by validateHtfAnchors, which is
        // calendar-aware (expected closure during weekend/halt/break-edge is not a
        // missing bar). BLOCKED/ERROR on a present row always blocks.
        const blockedSourceRows = rawRows.filter((r) => ["BLOCKED", "ERROR", "MISSING"].includes(String(r.eligibility_state))).length;
        const firstIncompleteAnchor = findFirstIncompleteHtfAnchor(expectedAnchors, canonicalSources, minutes, ctx.symbol);
        const incompleteSourceDiagnosis = firstIncompleteAnchor
          ? diagnoseHtfSourceWindow(firstIncompleteAnchor, canonicalSources.get(firstIncompleteAnchor) ?? [], minutes, ctx.symbol)
          : null;
        const blockedSourceTimestamps = rawRows
          .filter((r) => r.source_ts != null && ["BLOCKED", "ERROR", "MISSING"].includes(String(r.eligibility_state)))
          .map((r) => ({ ts: normalizeAnchor(r.source_ts), state: String(r.eligibility_state), broker: r.broker ?? null }));
        anchorValidation = { ...validation, firstIncompleteAnchor, incompleteSourceDiagnosis, nonTradableHtfRows: anchorMaps.htfAnchors.length - canonicalHtfAnchors.length, rawRows: rawRows.length, blockedSourceRows, blockedSourceTimestamps, lineageRows: rawRows.filter((r) => r.lineage_id != null).length, sourceBounds: { first: rawRows.find((r) => r.source_ts != null)?.source_ts ?? null, last: [...rawRows].reverse().find((r) => r.source_ts != null)?.source_ts ?? null } };
        closureFailures = validation.missingHtf + validation.extraHtf + validation.incompleteSource + (blockedSourceRows > 0 ? 1 : 0);
      }
      // present > expectedBars is also an anomaly (excess persisted bars = non-tradable rows
      // leaking into canonical). Flag both directions.
      const hasUnexpectedGap = present !== expectedBars;
      const closedBarChecked = tf === "1m" ? blocked === 0 : closureFailures === 0 && blocked === 0 && anchorValidation.closedBarChecked === true;
      const warmup = await selectOne(db, `SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(*)::int AS rows FROM ${table} WHERE symbol = $1 AND ts < $2`, [ctx.symbol, targetWindow.from]);
      reports.push({ timeframe: tf, table, expectedBars, presentBars: present, blockedBars: blocked, firstBarTs: row?.first_ts ?? null, lastBarTs: row?.last_ts ?? null, hasUnexpectedGap, closedBarChecked, closureFailures, anchorDiagnosis, anchorValidation, warmup: { firstTs: warmup?.first_ts ?? null, lastTs: warmup?.last_ts ?? null, rows: Number(warmup?.rows ?? 0), requiredFrom: window.from, requiredTo: targetWindow.from, status: warmup?.first_ts ? "PRESENT_NON_CANONICAL" : "MISSING" }, calendarPolicyVersion: "market-calendar-v1", htfSourceVersion: "canonical-1m-raw-lineage-v2-calendar-aware", oneMinuteClosurePolicyVersion: "closure-v1", status: blocked ? "BLOCKED_ANOMALY" : hasUnexpectedGap || !closedBarChecked ? "FAIL" : "PASS" });
    } catch (error) {
      console.error(`[preflight] canonical timeframe ${tf} failed:`, error instanceof Error ? error.message : String(error));
      reports.push({ timeframe: tf, table, expectedBars: null, presentBars: 0, blockedBars: 0, hasUnexpectedGap: true, closedBarChecked: false, status: "BLOCKED_UNKNOWN", reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return reports;
}

async function featureReports(db: Queryable, ctx: CandidateContext, window: { from: string; to: string }) {
  const dependencies = Array.isArray(ctx.dependencies) ? ctx.dependencies as Array<Record<string, unknown>> : [];
  const reports: Array<Record<string, unknown>> = [];
  for (const dependency of dependencies) {
    const name = String(dependency.feature ?? "");
    const table = `features_${name.replace(/^features_/, "")}`;
    if (!/^features_[a-z0-9_]+$/.test(table)) {
      reports.push({ name, table, status: "BLOCKED_UNKNOWN", reason: "invalid feature table identifier" });
      continue;
    }
    try {
      const result = await db.query(`
        SELECT COUNT(*)::int AS rows, MIN(ts) AS first_ts, MAX(ts) AS last_ts
        FROM ${table}
        WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts < $4`,
      [ctx.symbol, String(dependency.timeframe), window.from, window.to]);
      const row = result.rows[0] as Row;
      const run = await selectOne(db, `
        SELECT producer_version, status, source_min_ts, source_max_ts, watermark_ts
        FROM feature_producer_runs
        WHERE feature_table = $1 AND symbol = $2 AND tf = $3
          AND status = 'done' AND source_min_ts <= $4 AND source_max_ts >= $5
        ORDER BY finished_at DESC LIMIT 1`, [table, ctx.symbol, String(dependency.timeframe), window.from, window.to]);
      reports.push({ name, table, timeframe: dependency.timeframe, rows: Number(row.rows ?? 0),
        firstTs: row.first_ts ?? null, lastTs: row.last_ts ?? null,
        producerVersion: run?.producer_version ?? null, producerStatus: run?.status ?? null,
        runsCoveringWindow: Boolean(run), pitChecked: true, closedBarChecked: false,
        status: run && Number(row.rows ?? 0) > 0 ? "PASS" : "BLOCKED_UNKNOWN" });
    } catch (error) {
      reports.push({ name, table, status: "BLOCKED_UNKNOWN", reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return reports;
}

export async function checkCanonicalEligibility(db: Queryable, ctx: CandidateContext): Promise<PreflightCheck> {
  const window = await expandedWindow(db, ctx);
  const timeframeCoverage = await canonicalTimeframeReports(db, ctx, window);
  const row = await selectOne(db, `
    SELECT COUNT(*)::int AS rows,
           COUNT(*) FILTER (WHERE e.state IN ('BLOCKED', 'ERROR'))::int AS ineligible
    FROM market.candles_1m_canonical c
    LEFT JOIN market.candle_eligibility e
      ON e.symbol = c.symbol AND e.broker = c.broker AND e.ts = c.ts AND e.timeframe = '1m'
    WHERE c.symbol = $1 AND c.ts >= $2 AND c.ts < $3`, [ctx.symbol, window.from, ctx.toTs]);
  const ok = Boolean(row && Number(row.ineligible ?? 0) === 0 && Number(row.rows ?? 0) > 0 && timeframeCoverage.every((item) => item.status === "PASS"));
  return { ok, status: ok ? "PASS" : "FAIL", reason: row && Number(row.rows ?? 0) === 0 ? "gap" : "eligibility", evidence: evidence(ctx, { requiredWindow: window, canonical: row ?? { missing: true }, timeframeCoverage }) };
}

/**
 * Greedy trusted-window chain coverage over 1m windows. Mirrors the runtime
 * gate semantics in scripts/lib/trusted-gate.js (evaluateTrustedGate): trust
 * is a 1m-canonical property, windows chain, and only rows with non-null
 * detector_version/canonical_version/gate_summary are consumable.
 *
 * Calendar-expected coverage breaks (weekend close, XAUUSD daily halt) still
 * interrupt the chain here — windows are certified on tradable history, so a
 * break means an uncertified island, not a calendar artifact.
 */
export function trustedWindowChain(
  windows: ReadonlyArray<{ window_id: number | string; window_start: string; window_end: string }>,
  fromTs: string,
  toTs: string,
): { covered: boolean; windowIds: number[]; firstGapStart: string | null; firstGapEnd: string | null } {
  const sorted = [...windows]
    .map((w) => ({ id: Number(w.window_id), start: new Date(String(w.window_start)).getTime(), end: new Date(String(w.window_end)).getTime() }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const from = new Date(String(fromTs)).getTime();
  const to = new Date(String(toTs)).getTime();
  let cursor = from;
  const used: number[] = [];
  let firstGapStart: string | null = null;
  let firstGapEnd: string | null = null;
  for (const w of sorted) {
    if (w.end <= cursor) continue;
    if (w.start > cursor) {
      if (firstGapStart === null) {
        firstGapStart = new Date(cursor).toISOString();
        firstGapEnd = new Date(Math.min(w.start, to)).toISOString();
      }
      continue; // gap before this window — chain broken, but keep scanning for evidence
    }
    cursor = Math.max(cursor, w.end);
    used.push(w.id);
    if (cursor >= to) break;
  }
  const covered = cursor >= to;
  if (!covered && firstGapStart === null && cursor < to) {
    // chain ended before target — trailing gap after last window
    firstGapStart = new Date(cursor).toISOString();
    firstGapEnd = new Date(to).toISOString();
  }
  return { covered, windowIds: used.sort((a, b) => a - b), firstGapStart, firstGapEnd };
}

export async function checkTrustedPrehistory(db: Queryable, ctx: CandidateContext): Promise<PreflightCheck> {
  const window = await expandedWindow(db, ctx);
  // Trusted windows are certified at 1m (trusted-gate.js hardcodes timeframe='1m').
  // Do NOT filter by ctx.timeframe — a 15m strategy consumes the same 1m trust chain.
  const result = await db.query(`
    SELECT window_id, window_start, window_end, detector_version, canonical_version
    FROM market.trusted_windows
    WHERE symbol = $1 AND timeframe = '1m' AND status = 'trusted'
      AND detector_version IS NOT NULL AND canonical_version IS NOT NULL AND gate_summary IS NOT NULL
    ORDER BY window_start`, [ctx.symbol]);
  const windows = result.rows as Array<{ window_id: number | string; window_start: string; window_end: string; detector_version: string; canonical_version: string }>;
  const chain = trustedWindowChain(windows, window.from, window.to);
  const ok = chain.covered && windows.length > 0;
  const used = new Set(chain.windowIds.map(Number));
  const usedRows = windows.filter((w) => used.has(Number(w.window_id)));
  return {
    ok,
    status: ok ? "PASS" : "BLOCKED_UNKNOWN",
    evidence: evidence(ctx, {
      requiredWindow: window,
      trustedWindow: ok
        ? { chain: true, windowIds: chain.windowIds, detectors: [...new Set(usedRows.map((w) => w.detector_version))], canonicalVersions: [...new Set(usedRows.map((w) => w.canonical_version))] }
        : { missing: true, trustedWindowRows: windows.length, firstGapStart: chain.firstGapStart, firstGapEnd: chain.firstGapEnd },
    }),
  };
}

export async function checkFeatureLineage(db: Queryable, ctx: CandidateContext): Promise<PreflightCheck> {
  const window = await expandedWindow(db, ctx);
  const features = await featureReports(db, ctx, window);
  const row = await selectOne(db, `
    SELECT COUNT(*)::int AS rows
    FROM market.candle_producer_lineage
    WHERE symbol = $1 AND candle_ts >= $2 AND candle_ts < $3`, [ctx.symbol, window.from, ctx.toTs]);
  const ok = Boolean(row && Number(row.rows ?? 0) > 0 && features.length > 0 && features.every((item) => item.status === "PASS"));
  return { ok, status: ok ? "PASS" : "BLOCKED_UNKNOWN", evidence: evidence(ctx, { requiredWindow: window, dependencies: ctx.dependencies ?? [], features, lineage: row ?? { missing: true } }) };
}

export async function checkSetupLineage(db: Queryable, ctx: CandidateContext): Promise<PreflightCheck> {
  const row = await selectOne(db, `
    SELECT COUNT(*)::int AS rows,
           COUNT(*) FILTER (WHERE block_reasons IS NOT NULL AND cardinality(block_reasons) > 0)::int AS blocked,
           COUNT(*) FILTER (WHERE evidence IS NULL)::int AS missing_evidence
    FROM setup_evaluations
    WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts < $4`, [ctx.symbol, ctx.timeframe, ctx.fromTs, ctx.toTs]);
  const ok = Boolean(row && Number(row.rows ?? 0) > 0 && Number(row.missing_evidence ?? 0) === 0);
  return { ok, status: ok ? "PASS" : "BLOCKED_UNKNOWN", evidence: evidence(ctx, row ?? { missing: true }) };
}

export async function buildReadOnlyPreflightChecks(db: Queryable, ctx: CandidateContext): Promise<PreflightChecks> {
  const canonical = await checkCanonicalEligibility(db, ctx);
  const trustedPrehistory = await checkTrustedPrehistory(db, ctx);
  const featureLineage = await checkFeatureLineage(db, ctx);
  const setupLineage = await checkSetupLineage(db, ctx);
  // These checks require run-specific policy/report inputs. Fail closed until
  // callers provide evidence through the pure evaluator input contract.
  const window = await expandedWindow(db, ctx);
  const blocked = { ok: false, status: "BLOCKED_UNKNOWN" as const, evidence: evidence(ctx, { source: "caller-required", requiredWindow: window, dependencies: ctx.dependencies ?? [] }) };
  const dxy = ctx.dxyDependency === "not_required"
    ? { ok: true, status: "NOT_REQUIRED" as const, evidence: evidence(ctx, { policy: "NOT_REQUIRED", reason: "strategy has no DXY dependency" }) }
    : blocked;
  const parity = { ok: false, status: "NOT_RUN" as const, evidence: evidence(ctx, { source: "separate parity workflow" }) };
  return { canonical, trustedPrehistory, warmup: blocked, featureLineage, dxy, setupLineage, parity };
}