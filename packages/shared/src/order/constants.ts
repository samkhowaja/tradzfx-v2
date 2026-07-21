/**
 * Shared order status constants — single source of truth.
 *
 * Every consumer (position manager, gates, pipeline runner) must import these
 * rather than defining inline arrays. This prevents the class of bugs where
 * one module uses ["pending","sent","filled"] and another uses
 * ["pending","sent","acked"], causing position caps to miss filled trades.
 *
 * Audit item #11: ACTIVE_STATUSES fix.
 */

/** Statuses that count as "active" for position caps and heat checks. */
export const ACTIVE_ORDER_STATUSES = ["pending", "sent", "filled"] as const;
export type ActiveOrderStatus = (typeof ACTIVE_ORDER_STATUSES)[number];

/** Statuses that count toward position limits (subset of active). */
export const POSITION_COUNTING_STATUSES = ["filled"] as const;

/** Full lifecycle a live pipeline order transitions through. */
export const ORDER_LIFECYCLE = ["pending", "sent", "filled", "expired", "rejected"] as const;
