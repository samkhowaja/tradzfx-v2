export const toneForPnl = (pnl: number | null | undefined) => {
  if (pnl == null || !Number.isFinite(pnl)) return "muted" as const;
  return pnl >= 0 ? ("long" as const) : ("short" as const);
};

export const toneForOutcome = (outcome: string | null | undefined) => {
  if (!outcome) return "muted" as const;
  if (outcome === "TP_HIT") return "long" as const;
  if (outcome === "SL_HIT") return "short" as const;
  if (outcome === "MANUAL") return "warn" as const;
  return "muted" as const;
};

export const textForOutcome = (outcome: string | null | undefined) => {
  if (!outcome) return "—";
  const map: Record<string, string> = {
    TP_HIT: "TP",
    SL_HIT: "SL",
    MANUAL: "Manual",
    EXPIRED: "Expired",
    MARGIN_CALL: "Margin",
  };
  return map[outcome] ?? outcome;
};

export const sideTone = (side: string | null | undefined) => {
  if (side === "buy" || side === "BUY" || side === "long") return "long" as const;
  if (side === "sell" || side === "SELL" || side === "short") return "short" as const;
  return "muted" as const;
};
