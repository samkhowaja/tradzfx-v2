import "dotenv/config";
import crypto from "crypto";
import { closePool, getPool } from "../packages/shared/src";
import { compileStrategy, loadStrategyFromDB } from "../packages/strategies/src";
import {
  compareReplayDecision,
  compareReplaySignal,
  type ComparableSignal,
} from "../packages/tradePipeline/src/replayComparison";
import { runLivePipeline } from "../packages/tradePipeline/src/liveRunner";

interface CliOptions {
  variant: string;
  symbol: string;
  start: Date;
  end: Date;
  persistAudit: boolean;
}

interface LiveSignalRow {
  signal_id: string;
  deployment_id: string;
  strategy_snapshot_id: string;
  snapshot_spec_json: unknown;
  compiled_strategy_snapshot_id: string | null;
  pit_signal_sql: string | null;
  compiler_version: string | null;
  registry_version: string | null;
  signal_fingerprint: string | null;
  symbol: string;
  strategy_id: string;
  ts: Date;
  side: "buy" | "sell";
  entry_type: "market" | "limit" | "stop";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
}

function value(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseCli(args: string[]): CliOptions {
  const variant = value(args, "variant");
  const symbol = value(args, "symbol");
  const startRaw = value(args, "start");
  const endRaw = value(args, "end");
  if (!variant || !symbol || !startRaw || !endRaw) {
    throw new Error("Usage: pnpm tsx scripts/replay-live-signals.ts --variant=<id> --symbol=<symbol> --start=<ISO> --end=<ISO> [--persist-audit]");
  }
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new Error("Invalid replay window: require valid start < end");
  }
  return { variant, symbol, start, end, persistAudit: args.includes("--persist-audit") };
}

function toSignal(row: any, fallbackStrategyId: string): ComparableSignal | null {
  if (!row) return null;
  const signal: ComparableSignal = {
    symbol: String(row.symbol),
    strategyId: String(row.strategy_id ?? fallbackStrategyId),
    ts: new Date(row.ts),
    side: row.side,
    entryType: row.entry_type ?? "market",
    entryPrice: Number(row.entry_price),
    stopLoss: Number(row.stop_loss),
    takeProfit: Number(row.take_profit),
  };
  if (
    ![signal.entryPrice, signal.stopLoss, signal.takeProfit].every(Number.isFinite) ||
    (signal.side !== "buy" && signal.side !== "sell")
  ) return null;
  return signal;
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  const pool = getPool();
  const spec = await loadStrategyFromDB(pool, opts.variant);
  if (!spec) throw new Error(`Strategy not found: ${opts.variant}`);

  const compileForReplay = (replaySpec: typeof spec) => compileStrategy(replaySpec, {
    mode: "pit",
    trustStoredLifecycle: false,
    asOfParameter: 3,
  });
  const currentCompiled = compileForReplay(spec);
  const snapshotCompiled = new Map<string, ReturnType<typeof compileForReplay>>();
  const currentTtl = `${spec.live?.signalTtlMinutes ?? 15} minutes`;
  const specHash = crypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex");

  const { rows: anchorRows } = await pool.query<{ ts: Date }>(
    `SELECT ts
       FROM market.candles_1m_canonical
      WHERE symbol = $1
        AND ts >= $2
        AND ts <= $3
        AND EXTRACT(MINUTE FROM ts)::int % 15 = 0
        AND EXTRACT(SECOND FROM ts)::int = 0
      ORDER BY ts`,
    [opts.symbol, opts.start, opts.end],
  );

  let runId: string | undefined;
  if (opts.persistAudit) {
    const { rows } = await pool.query<{ run_id: string }>(
      `INSERT INTO signal_replay_run
         (variant_id, symbol, start_ts, end_ts, spec_hash, code_version, mode)
       VALUES ($1, $2, $3, $4, $5, $6, 'persist_audit')
       RETURNING run_id`,
      [opts.variant, opts.symbol, opts.start, opts.end, specHash, process.env.GIT_COMMIT ?? null],
    );
    runId = rows[0].run_id;
  }

  const summary = { anchors: 0, matches: 0, mismatches: 0, classes: {} as Record<string, number> };
  for (const anchor of anchorRows) {
    const evaluationTs = new Date(anchor.ts);
    const { rows: liveRows } = await pool.query<LiveSignalRow>(
      `SELECT ls.signal_id, ls.deployment_id, ls.signal_fingerprint,
              ld.strategy_snapshot_id, ss.spec_json AS snapshot_spec_json,
              ld.compiled_strategy_snapshot_id, cs.pit_signal_sql,
              cs.compiler_version, cs.registry_version,
              ls.symbol, ls.strategy_id, ls.ts, ls.side, ls.entry_type,
              ls.entry_price, ls.stop_loss, ls.take_profit
         FROM live_signal ls
         JOIN live_deployment ld ON ld.deployment_id = ls.deployment_id
         JOIN strategy_settings_snapshot ss ON ss.snapshot_id = ld.strategy_snapshot_id
         LEFT JOIN compiled_strategy_snapshot cs
           ON cs.snapshot_id = ld.compiled_strategy_snapshot_id
        WHERE ls.symbol = $1
          AND ls.strategy_id = $2
          AND ls.ts <= $3
          AND ls.ts >= $3 - $4::interval
        ORDER BY ls.ts DESC
        LIMIT 1`,
      [opts.symbol, spec.id, evaluationTs, currentTtl],
    );
    const liveRow = liveRows[0];
    let anchorCompiled = currentCompiled;
    if (liveRow) {
      const snapshotSpec = liveRow.snapshot_spec_json as typeof spec;
      if (liveRow.pit_signal_sql) {
        const storedSql = liveRow.pit_signal_sql;
        anchorCompiled = {
          ...currentCompiled,
          spec: snapshotSpec,
          signalAtSQL: () => storedSql,
        };
      } else {
        const cached = snapshotCompiled.get(liveRow.strategy_snapshot_id);
        if (cached) {
          anchorCompiled = cached;
        } else {
          try {
            anchorCompiled = compileForReplay(snapshotSpec);
            snapshotCompiled.set(liveRow.strategy_snapshot_id, anchorCompiled);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            summary.anchors += 1;
            summary.mismatches += 1;
            summary.classes.MISSING_PROVENANCE = (summary.classes.MISSING_PROVENANCE ?? 0) + 1;
            console.log(JSON.stringify({
              evaluationTs: evaluationTs.toISOString(),
              mismatchClass: "MISSING_PROVENANCE",
              differences: ["compiled_strategy_snapshot_missing"],
              live: toSignal(liveRow, spec.id),
              strategySnapshotId: liveRow.strategy_snapshot_id,
              reason,
            }));
            continue;
          }
        }
      }
    }
    const signalSql = anchorCompiled.signalAtSQL();
    const ttl = `${anchorCompiled.spec.live?.signalTtlMinutes ?? 15} minutes`;
    const { rows: replayRows } = await pool.query(signalSql, [opts.symbol, ttl, evaluationTs]);
    const replay = toSignal(replayRows[0], anchorCompiled.spec.id);
    const live = toSignal(liveRow, anchorCompiled.spec.id);
    const comparison = compareReplaySignal(replay, live);

    const decision = replay
      ? await runLivePipeline({
          symbol: opts.symbol,
          strategySpec: anchorCompiled.spec,
          latestSignalSQL: signalSql,
          pool,
          evaluationTs,
          signalAsOfParameter: evaluationTs,
          evaluationOnly: true,
          createOrder: async () => {
            throw new Error("evaluation-only replay attempted order creation");
          },
        })
      : { orderCreated: false, reason: "no_signal", trace: null };
    const { rows: liveDecisionRows } = liveRow
      ? await pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM live_order WHERE signal_id = $1
           ) AS executed,
           CASE WHEN EXISTS (
             SELECT 1 FROM live_order WHERE signal_id = $1
           ) THEN NULL ELSE (
             SELECT reason FROM live_signal_rejection
             WHERE deployment_id = $2
               AND symbol = $3
               AND strategy_id = $4
               AND (
                 signal_fingerprint = $5
                 OR (signal_fingerprint IS NULL AND ts = $6)
               )
             ORDER BY created_at ASC LIMIT 1
           ) END AS reason`,
          [
            liveRow.signal_id,
            liveRow.deployment_id,
            opts.symbol,
            spec.id,
            liveRow.signal_fingerprint,
            liveRow.ts,
          ],
        )
      : { rows: [{ executed: false, reason: "no_signal" }] };
    const decisionComparison = compareReplayDecision(
      { executed: decision.orderCreated === true, reason: decision.reason ?? null },
      { executed: liveDecisionRows[0]?.executed === true, reason: liveDecisionRows[0]?.reason ?? null },
    );

    summary.anchors += 1;
    const fullMatch = comparison.signalMatch && decisionComparison.decisionMatch;
    if (fullMatch) summary.matches += 1;
    else summary.mismatches += 1;
    const mismatchClass = comparison.signalMatch
      ? decisionComparison.mismatchClass
      : comparison.mismatchClass;
    summary.classes[mismatchClass] = (summary.classes[mismatchClass] ?? 0) + 1;

    const output = {
      evaluationTs: evaluationTs.toISOString(),
      mismatchClass,
      differences: [...comparison.differences, ...decisionComparison.differences],
      replay,
      live,
      replayDecision: decision,
      liveDecision: liveDecisionRows[0],
    };
    if (!fullMatch) console.log(JSON.stringify(output));

    if (runId) {
      await pool.query(
        `INSERT INTO signal_replay_result (
           run_id, symbol, evaluation_ts, strategy_id, replay_signal_ts,
           live_signal_id, replay_fingerprint, live_fingerprint,
           signal_match, geometry_match, mismatch_class, differences,
           replay_json, live_json, decision_match, replay_executed,
           live_executed, replay_reason, live_reason, replay_decision_json
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                   $15,$16,$17,$18,$19,$20)`,
        [
          runId, opts.symbol, evaluationTs, spec.id,
          replay ? new Date(replay.ts) : null, liveRow?.signal_id ?? null,
          comparison.replayFingerprint ?? null, comparison.liveFingerprint ?? null,
          comparison.signalMatch, comparison.geometryMatch, mismatchClass,
          JSON.stringify([...comparison.differences, ...decisionComparison.differences]),
          replay ? JSON.stringify(replay) : null, live ? JSON.stringify(live) : null,
          decisionComparison.decisionMatch, decision.orderCreated === true,
          liveDecisionRows[0]?.executed === true, decision.reason ?? null,
          liveDecisionRows[0]?.reason ?? null, JSON.stringify(decision),
        ],
      );
    }
  }

  if (runId) {
    await pool.query(
      `UPDATE signal_replay_run
          SET anchors_evaluated=$2, matches=$3, mismatches=$4,
              completed_at=NOW(), summary_json=$5
        WHERE run_id=$1`,
      [runId, summary.anchors, summary.matches, summary.mismatches, JSON.stringify(summary)],
    );
  }

  console.log(JSON.stringify({ variant: opts.variant, symbol: opts.symbol, readOnly: !opts.persistAudit, runId, ...summary }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
