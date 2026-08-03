/**
 * Direction Alignment Gate.
 * Blocks entry when higher-timeframe direction doesn't align with the signal.
 *
 * Professional traders check 2-3 timeframes for confluence before taking a
 * swing trade.  Scalper specs disable this gate (enabled: false).
 *
 * The gate reads `features_direction_state` (Direction Arbiter) which
 * reconciles features_bias + features_htf_bias into one regime-classified
 * direction per (symbol, tf, ts).  If direction_state is unavailable for
 * a configured timeframe (table missing, sparse data, or not yet backfilled),
 * that timeframe is treated as "no vote" — it never blocks.
 */

import type { MarketContext } from "@tm/shared";

export interface DirectionAlignmentConfig {
  /** Quick disable for scalper specs. Default true. */
  enabled?: boolean;
  /** Timeframes to check, ordered high-to-low. Example: ["1h", "15m", "5m"] */
  timeframes: string[];
  /**
   * How many TFs must align:
   *   "all"      — every non-neutral vote agrees with signal side
   *   "majority" — >50% of non-neutral votes agree
   *   "any"      — at least one non-neutral TF agrees
   * Default "majority".
   */
  require?: "all" | "majority" | "any";
  /**
   * When true, a neutral direction_state never blocks — it abstains.
   * When false, neutral is treated as a disagreeing vote.
   * Default true (neutral abstains).
   */
  allowNeutral?: boolean;
  /**
   * Optional: require the regime to be one of these values (e.g. "trending")
   * before the gate allows entry.  If empty, regime is not checked.
   */
  requireRegime?: string[];
}

export function createDirectionAlignmentGate(config: DirectionAlignmentConfig) {
  const enabled = config.enabled ?? true;
  const require = config.require ?? "majority";
  const allowNeutral = config.allowNeutral ?? true;
  const requireRegime = config.requireRegime ?? [];

  return async (ctx: MarketContext): Promise<{ passed: boolean; reason?: string }> => {
    if (!enabled) {
      return { passed: true };
    }

    const signal = ctx.signal;
    if (!signal) {
      return { passed: false, reason: "No signal to align direction against" };
    }

    const signalSide = signal.side?.toLowerCase(); // "buy" | "sell"
    if (signalSide !== "buy" && signalSide !== "sell") {
      return { passed: false, reason: `Signal side "${signalSide}" is not buy/sell` };
    }

    const tfs = config.timeframes;
    if (tfs.length === 0) {
      return { passed: true }; // nothing to check
    }

    // Gather votes from each timeframe.  "buy" ↔ "bullish", "sell" ↔ "bearish"
    const votes: { tf: string; agrees: boolean; regime?: string }[] = [];
    const features = ctx.features;

    for (const tf of tfs) {
      const ds = features[`features_direction_state@${tf}`] as
        | { direction?: string; regime?: string; agreement?: boolean }
        | undefined;

      if (!ds || !ds.direction) {
        // No data for this TF — abstain (never blocks)
        continue;
      }

      const dir = ds.direction.toLowerCase();
      let agrees: boolean;

      if (dir === "neutral") {
        if (allowNeutral) {
          continue; // abstain
        }
        agrees = false;
      } else if (signalSide === "buy") {
        agrees = dir === "bullish";
      } else {
        agrees = dir === "bearish";
      }

      // Check regime requirement per TF (if any)
      if (agrees && requireRegime.length > 0 && ds.regime) {
        if (!requireRegime.includes(ds.regime.toLowerCase())) {
          agrees = false;
        }
      }

      votes.push({ tf, agrees, regime: ds.regime });
    }

    if (votes.length === 0) {
      // All TFs abstained or no data — pass (no info to block on)
      return { passed: true };
    }

    const agreeing = votes.filter((v) => v.agrees).length;
    const required: number =
      require === "all"
        ? votes.length
        : require === "any"
          ? 1
          : Math.floor(votes.length / 2) + 1; // majority

    if (agreeing < required) {
      const voteSummary = votes
        .map((v) => `${v.tf}=${v.agrees ? "agree" : "disagree"}${v.regime ? `(${v.regime})` : ""}`)
        .join(", ");
      return {
        passed: false,
        reason: `MTF direction: ${agreeing}/${votes.length} TFs agree with ${signalSide} ` +
          `(need ${require}=${required}) [${voteSummary}]`,
      };
    }

    return { passed: true };
  };
}
