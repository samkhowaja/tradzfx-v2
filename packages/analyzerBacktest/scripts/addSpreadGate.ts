import { getPool, closePool } from "@tm/shared";

async function main() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, spec_json FROM strategy_specs WHERE id = 'waqar_v2_15m'`
  );
  if (rows.length === 0) {
    console.log("waqar_v2_15m not found");
    await closePool();
    return;
  }

  const spec = rows[0].spec_json;
  const gates = spec.gates ?? [];
  const hasSpread = gates.some((g: any) => g.name === "spread" || g.id === "spread_gate");
  if (hasSpread) {
    console.log("waqar_v2_15m already has a spread gate");
    await closePool();
    return;
  }

  const maxSpreadPips = spec.live?.maxSpreadPips ?? 3;
  gates.push({
    id: "spread_gate",
    name: "spread",
    params: { maxSpreadPips },
  });

  await pool.query(
    `UPDATE strategy_specs SET spec_json = $1::jsonb WHERE id = 'waqar_v2_15m'`,
    [JSON.stringify(spec)]
  );
  console.log("Added spread_gate to waqar_v2_15m with maxSpreadPips =", maxSpreadPips);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
