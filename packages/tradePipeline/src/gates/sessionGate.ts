/**
 * Session Gate.
 * Blocks entry outside allowed trading sessions.
 * Supports both feature-based session detection and explicit UTC time windows.
 */

import type { MarketContext } from "@tm/shared";

export interface SessionGateConfig {
  allowed?: string[];
  /** Explicit UTC windows: "HH:MM-HH:MM" */
  windows?: string[];
}

function parseWindow(win: string): { start: number; end: number } {
  const [startStr, endStr] = win.split("-");
  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);
  return { start: sh * 60 + sm, end: eh * 60 + em };
}

function isInWindow(ts: Date, windows: string[]): boolean {
  const utcMin = ts.getUTCHours() * 60 + ts.getUTCMinutes();
  for (const w of windows) {
    const { start, end } = parseWindow(w);
    if (utcMin >= start && utcMin <= end) return true;
  }
  return false;
}

export function createSessionGate(config: SessionGateConfig) {
  const allowedSet = config.allowed
    ? new Set(config.allowed.map((s) => s.toUpperCase()))
    : null;

  return async (
    ctx: MarketContext
  ): Promise<{ passed: boolean; reason?: string }> => {
    // 1. Explicit time windows take precedence
    if (config.windows && config.windows.length > 0) {
      if (isInWindow(ctx.ts, config.windows)) {
        return { passed: true };
      }
      return {
        passed: false,
        reason: `UTC ${ctx.ts.getUTCHours()}:${String(
          ctx.ts.getUTCMinutes()
        ).padStart(2, "0")} outside windows=[${config.windows.join(", ")}]`,
      };
    }

    // 2. Feature-based session detection
    const session = (ctx.features["features_session"] as any)?.session;

    if (!session) {
      return { passed: false, reason: "No session data available" };
    }

    if (!allowedSet || !allowedSet.has(session.toUpperCase())) {
      return {
        passed: false,
        reason: `Session=${session} not in allowed=[${
          config.allowed?.join(", ") ?? ""
        }]`,
      };
    }

    return { passed: true };
  };
}
