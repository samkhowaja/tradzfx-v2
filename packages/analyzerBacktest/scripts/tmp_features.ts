import { getPool, closePool } from "@tm/shared";
async function main() {
  const p = getPool();
  const features = ["features_bias", "features_htf_bias", "features_pricing", "features_zone", "features_structure", "features_pivot", "features_atr", "features_spread", "features_session", "features_displacement", "features_ifvg", "features_ema_cross", "features_opening_range", "features_candle_pattern", "features_zone_retest"];
  for (const f of features) {
    try {
      const { rows } = await p.query(`SELECT MAX(ts) as latest FROM ${f}`);
      console.log(`[${f}] latest=${rows[0].latest?.toISOString?.() ?? 'null'}`);
    } catch (e: any) {
      console.log(`[${f}] error: ${e.message}`);
    }
  }
  await closePool();
}
main();
