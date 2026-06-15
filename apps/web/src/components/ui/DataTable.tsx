interface Column<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "right" | "center";
  cell: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  keyExtractor,
  emptyText = "No data",
}: {
  columns: Column<T>[];
  rows: T[];
  keyExtractor: (row: T) => string;
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-text-dim">{emptyText}</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-text-dim ${
                  col.width ?? ""
                } ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyExtractor(row)}
              className="border-b border-border/50 hover:bg-elevated/50 transition-colors"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 text-[12px] ${
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                      ? "text-center"
                      : "text-left"
                  }`}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
