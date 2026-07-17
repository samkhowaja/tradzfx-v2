import fs from "node:fs";
import path from "node:path";

export interface SignalCandidateAuditRecord {
  strategy_id: string;
  symbol: string;
  tf?: string | null;
  ts: string | Date;
  side?: string | null;
  entry_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  bias_direction?: string | null;
  setup_family?: string | null;
  setup_grade?: string | null;
  setup_block_reasons?: unknown;
  gate_results?: unknown;
  decision_stage: string;
  decision_reason?: string | null;
  feature_snapshot?: unknown;
  fingerprint?: string | null;
  dedup_check_result?: string | null;
  engine_version?: string | null;
  spec_hash?: string | null;
  source: "live" | "backtest";
}

const spoolDir = path.join(process.cwd(), "logs", "candidate-spool");

function spoolFilePath(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return path.join(spoolDir, `candidates-${day}.jsonl`);
}

export function appendSignalCandidate(record: SignalCandidateAuditRecord): void {
  try {
    fs.mkdirSync(spoolDir, { recursive: true });
    fs.appendFileSync(
      spoolFilePath(),
      JSON.stringify({ ...record, created_at: new Date().toISOString() }) + "\n"
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[candidate-audit] failed to spool live candidate: ${message}`);
  }
}
