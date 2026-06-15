type BadgeTone = "brand" | "long" | "short" | "warn" | "info" | "muted";
type BadgeVariant = "solid" | "soft" | "outline";

const toneMap: Record<
  BadgeTone,
  { solid: string; soft: string; outline: string }
> = {
  brand: {
    solid: "bg-brand text-white",
    soft: "bg-brand-soft text-brand",
    outline: "border-brand/30 text-brand",
  },
  long: {
    solid: "bg-long text-white",
    soft: "bg-long-soft text-long",
    outline: "border-long/30 text-long",
  },
  short: {
    solid: "bg-short text-white",
    soft: "bg-short-soft text-short",
    outline: "border-short/30 text-short",
  },
  warn: {
    solid: "bg-warn text-black",
    soft: "bg-warn-soft text-warn",
    outline: "border-warn/30 text-warn",
  },
  info: {
    solid: "bg-info text-white",
    soft: "bg-info-soft text-info",
    outline: "border-info/30 text-info",
  },
  muted: {
    solid: "bg-elevated text-text-muted",
    soft: "bg-elevated text-text-dim",
    outline: "border-border-strong text-text-dim",
  },
};

export function Badge({
  children,
  tone = "muted",
  variant = "soft",
  className = "",
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  className?: string;
}) {
  const styles = toneMap[tone][variant];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium border ${styles} ${className}`}
    >
      {children}
    </span>
  );
}
