"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import {
  formatR,
  formatPrice,
  formatCurrency,
  formatDateTime,
  sideTone,
  toneForOutcome,
  textForOutcome,
} from "@/lib/format";

export default function JournalPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/journal?page=${page}&limit=50`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [page]);

  return (
    <PageShell title="Journal" subtitle="Trade history and review">
      {loading || !data ? (
        <div className="text-text-dim">Loading trades...</div>
      ) : (
        <Panel
          title="Closed Trades"
          subtitle={`${data.pagination?.total ?? 0} total`}
          headerAction={
            data.pagination && data.pagination.pages > 1 ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Prev
                </Button>
                <span className="text-[11px] text-text-dim">
                  {page} / {data.pagination.pages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setPage((p) => Math.min(data.pagination.pages, p + 1))
                  }
                  disabled={page >= data.pagination.pages}
                >
                  Next
                </Button>
              </div>
            ) : null
          }
        >
          <DataTable
            columns={[
              {
                key: "symbol",
                header: "Pair",
                cell: (r: any) => (
                  <span className="font-medium text-text">{r.symbol}</span>
                ),
              },
              {
                key: "side",
                header: "Side",
                cell: (r: any) => (
                  <Badge tone={sideTone(r.side)} variant="soft" className="uppercase">
                    {r.side}
                  </Badge>
                ),
              },
              {
                key: "entry",
                header: "Entry",
                align: "right",
                cell: (r: any) => formatPrice(r.fill_price, r.symbol),
              },
              {
                key: "sl",
                header: "SL",
                align: "right",
                cell: (r: any) => formatPrice(r.stop_loss, r.symbol),
              },
              {
                key: "tp",
                header: "TP",
                align: "right",
                cell: (r: any) => formatPrice(r.take_profit, r.symbol),
              },
              {
                key: "outcome",
                header: "Outcome",
                cell: (r: any) => (
                  <Badge tone={toneForOutcome(r.outcome)} variant="soft">
                    {textForOutcome(r.outcome)}
                  </Badge>
                ),
              },
              {
                key: "r",
                header: "R",
                align: "right",
                cell: (r: any) => (
                  <span
                    className={
                      (r.outcome_r ?? 0) >= 0 ? "text-long" : "text-short"
                    }
                  >
                    {formatR(r.outcome_r)}
                  </span>
                ),
              },
              {
                key: "pnl",
                header: "P&L",
                align: "right",
                cell: (r: any) => (
                  <span
                    className={
                      (r.realized_pnl ?? 0) >= 0 ? "text-long" : "text-short"
                    }
                  >
                    {formatCurrency(r.realized_pnl)}
                  </span>
                ),
              },
              {
                key: "closed",
                header: "Closed",
                cell: (r: any) => (
                  <span className="text-text-dim">
                    {formatDateTime(r.closed_at)}
                  </span>
                ),
              },
            ]}
            rows={data.trades}
            keyExtractor={(r) => r.id}
            emptyText="No closed trades yet"
          />
        </Panel>
      )}
    </PageShell>
  );
}
