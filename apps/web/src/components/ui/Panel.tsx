export function Panel({
  children,
  title,
  subtitle,
  className = "",
  headerAction,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  headerAction?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-panel overflow-hidden ${className}`}
    >
      {(title || subtitle || headerAction) && (
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            {title && (
              <h3 className="text-[13px] font-semibold text-text">{title}</h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-text-dim">{subtitle}</p>
            )}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
