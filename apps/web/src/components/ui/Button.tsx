type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const variantMap: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-dim border-transparent",
  secondary:
    "bg-elevated text-text border-border hover:bg-panel-hover",
  ghost:
    "bg-transparent text-text-muted border-transparent hover:bg-elevated hover:text-text",
  danger:
    "bg-short text-white hover:bg-short-dim border-transparent",
};

const sizeMap: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-[11px]",
  md: "px-3 py-1.5 text-[13px]",
};

export function Button({
  children,
  variant = "secondary",
  size = "sm",
  className = "",
  onClick,
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-40 ${variantMap[variant]} ${sizeMap[size]} ${className}`}
    >
      {children}
    </button>
  );
}
