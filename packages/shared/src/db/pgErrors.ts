/**
 * PostgreSQL error-code helpers.
 *
 * Centralises unique-violation (23505) handling so that every INSERT that
 * might collide uses the same "fail as dedup, not abort" contract.
 *
 * Usage:
 *   const result = await pgSafeUnique(pool, query, params);
 *   if (!result.ok) {
 *     // row was a duplicate — treat as dedup-reject, never abort the txn
 *     return { signalId: result.existingId };
 *   }
 *   // result.row is the inserted or existing row
 */

/** PostgreSQL error codes */
export const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: "23505",
} as const;

export interface PgSafeUniqueResult<T = any> {
  /** true: the row was inserted (or found via ON CONFLICT). false: unique violation. */
  ok: boolean;
  /** The row returned by SQL, if any. */
  row?: T;
  /** The underlying error message, if any. */
  error?: string;
}

/**
 * Execute a query that may hit a unique-violation (23505) on an index OTHER
 * than the one covered by ON CONFLICT. Catches 23505 and returns `ok: false`
 * instead of aborting the transaction.
 *
 * Use when you have ON CONFLICT on one constraint but a second unique index
 * can also fire (e.g. a dedup-only fingerprint index on live_signal).
 *
 * @param queryFn - A function that returns rows, or throws with code 23505.
 * @returns PgSafeUniqueResult — callers MUST check `.ok` before proceeding.
 */
export async function pgSafeUnique<T = any>(
  queryFn: () => Promise<T[]>
): Promise<PgSafeUniqueResult<T>> {
  try {
    const rows = await queryFn();
    return { ok: true, row: rows[0] };
  } catch (err: any) {
    if (err?.code === PG_ERROR_CODES.UNIQUE_VIOLATION) {
      return { ok: false, error: err.message };
    }
    // Re-throw non-unique errors — those are real problems
    throw err;
  }
}
