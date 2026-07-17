import { NextRequest } from "next/server";
import { getPool } from "@tm/shared";

export function getMt5RequestApiKey(req: NextRequest): string {
  return req.headers.get("X-API-Key") || req.headers.get("x-api-key") || "";
}

export function getFallbackMt5ApiKey(): string {
  return process.env.TM_MT5_API_KEY ?? process.env.MT5_API_KEY ?? "";
}

export async function validateMt5ApiKey(req: NextRequest): Promise<boolean> {
  const apiKey = getMt5RequestApiKey(req);
  if (!apiKey) return false;

  try {
    const pool = getPool();
    const { rows } = await pool.query<{ key_matches: boolean; has_terminals: boolean }>(
      `SELECT
         EXISTS(SELECT 1 FROM mt5_terminals WHERE api_key = $1) AS key_matches,
         EXISTS(SELECT 1 FROM mt5_terminals) AS has_terminals`,
      [apiKey]
    );
    if (rows[0]?.key_matches) return true;
    if (rows[0]?.has_terminals) return false;
  } catch (err) {
    console.warn("[mt5-auth] DB API key check failed:", (err as Error).message);
  }

  const fallbackKey = getFallbackMt5ApiKey();
  return Boolean(fallbackKey && apiKey === fallbackKey);
}
