/**
 * Notification policy for the live pipeline.
 *
 * Centralizes Telegram (and future notification channels) so policies like
 * quiet hours, cooldowns, and per-event sound settings live in one place.
 */

import { sendTelegramMessage } from "@tm/shared";

export interface NotifyPolicy {
  /** Raw signal generated (before any gates). */
  signal: "off" | "silent" | "sound";
  /** Order successfully created. */
  orderCreated: "off" | "silent" | "sound";
  /** Order filled by the broker. */
  orderFilled: "off" | "silent" | "sound";
  /** Order rejected or creation failed. */
  orderRejected: "off" | "silent" | "sound";
  /** Quality engine rejected a signal before order creation. */
  qualityRejected: "off" | "silent" | "sound";
  /** A fill produced an actual R:R below the strategy minimum. */
  badFill: "off" | "silent" | "sound";
  /** Minimum seconds between two notifications with the same key. */
  cooldownSeconds: number;
}

const DEFAULT_POLICY: NotifyPolicy = {
  signal: process.env.TELEGRAM_NOTIFY_SIGNALS === "true" ? "silent" : "off",
  orderCreated: process.env.TELEGRAM_NOTIFY_ORDER_CREATED === "sound" ? "sound" : "silent",
  orderFilled: process.env.TELEGRAM_NOTIFY_ORDER_FILLED === "off" ? "off" : "sound",
  orderRejected: process.env.TELEGRAM_NOTIFY_FAILURES === "false" ? "off" : "sound",
  qualityRejected: process.env.TELEGRAM_NOTIFY_QUALITY_REJECTED === "sound" ? "sound" : "off",
  badFill: process.env.TELEGRAM_NOTIFY_BAD_FILL === "off" ? "off" : "sound",
  cooldownSeconds: Number(process.env.TELEGRAM_COOLDOWN_SECONDS ?? 300),
};

const lastNotifyTs = new Map<string, number>();

function policy(): NotifyPolicy {
  return DEFAULT_POLICY;
}

function cooldownKey(event: string, symbol: string, side?: string): string {
  return `${event}:${symbol}:${side ?? "any"}`;
}

function isOnCooldown(key: string, cooldownSeconds: number): boolean {
  if (cooldownSeconds <= 0) return false;
  const now = Date.now();
  const last = lastNotifyTs.get(key);
  if (last && now - last < cooldownSeconds * 1000) return true;
  lastNotifyTs.set(key, now);
  return false;
}

async function notify(
  level: "off" | "silent" | "sound",
  text: string,
  cooldownKeyStr?: string
): Promise<void> {
  if (level === "off") return;
  if (cooldownKeyStr) {
    const pol = policy();
    if (isOnCooldown(cooldownKeyStr, pol.cooldownSeconds)) return;
  }
  await sendTelegramMessage(text, { disableNotification: level === "silent" });
}

export async function notifySignal(
  symbol: string,
  side: string,
  strategyName: string,
  entry: number,
  sl: number,
  tp: number
): Promise<void> {
  const pol = policy();
  await notify(
    pol.signal,
    `🟡 <b>Signal</b> ${symbol} ${side.toUpperCase()}\nStrategy: ${strategyName}\nEntry: ${entry}\nSL: ${sl}\nTP: ${tp}`,
    cooldownKey("signal", symbol, side)
  );
}

export async function notifyOrderCreated(
  symbol: string,
  side: string,
  strategyName: string,
  mode: string,
  entry: number,
  sl: number,
  tp: number,
  lot: number,
  executionStrategy?: string
): Promise<void> {
  const pol = policy();
  const execNote = executionStrategy ? `\nExec: ${executionStrategy}` : "";
  await notify(
    pol.orderCreated,
    `🟢 <b>Order created</b> ${symbol} ${side.toUpperCase()}${execNote}\nStrategy: ${strategyName}\nMode: ${mode}\nEntry: ${entry}\nSL: ${sl}\nTP: ${tp}\nLot: ${lot}`,
    cooldownKey("order_created", symbol, side)
  );
}

export async function notifyOrderFilled(
  symbol: string,
  side: string,
  strategyName: string,
  fillPrice: number,
  lot: number
): Promise<void> {
  const pol = policy();
  await notify(
    pol.orderFilled,
    `✅ <b>Order filled</b> ${symbol} ${side.toUpperCase()}\nStrategy: ${strategyName}\nFill: ${fillPrice}\nLot: ${lot}`,
    cooldownKey("order_filled", symbol, side)
  );
}

export async function notifyOrderRejected(
  symbol: string,
  side: string,
  strategyName: string,
  reason: string
): Promise<void> {
  const pol = policy();
  await notify(
    pol.orderRejected,
    `🔴 <b>Order rejected</b> ${symbol} ${side.toUpperCase()}\nStrategy: ${strategyName}\nReason: ${reason}`,
    cooldownKey("order_rejected", symbol, side)
  );
}

export async function notifyQualityRejected(
  symbol: string,
  side: string,
  strategyName: string,
  reason: string
): Promise<void> {
  const pol = policy();
  await notify(
    pol.qualityRejected,
    `🟠 <b>Quality rejected</b> ${symbol} ${side.toUpperCase()}\nStrategy: ${strategyName}\nReason: ${reason}`,
    cooldownKey("quality_rejected", symbol, side)
  );
}

export async function notifyBadFill(
  symbol: string,
  side: string,
  strategyName: string,
  fillPrice: number,
  actualRR: number,
  minRR: number,
  ticket: number
): Promise<void> {
  const pol = policy();
  await notify(
    pol.badFill,
    `🚨 <b>Bad fill — closing</b> ${symbol} ${side.toUpperCase()}\n` +
      `Strategy: ${strategyName}\n` +
      `Ticket: ${ticket}\n` +
      `Fill: ${fillPrice.toFixed(5)}\n` +
      `Actual R:R: ${actualRR.toFixed(2)} (min ${minRR.toFixed(2)})`,
    cooldownKey("bad_fill", symbol, side)
  );
}

export async function notifyError(
  symbol: string,
  side: string,
  strategyName: string,
  context: string,
  error: string
): Promise<void> {
  // Errors are always sound and ignore cooldown so the user sees them.
  await sendTelegramMessage(
    `⛔ <b>Error</b> ${context} ${symbol} ${side.toUpperCase()}\nStrategy: ${strategyName}\nError: ${error}`
  );
}
