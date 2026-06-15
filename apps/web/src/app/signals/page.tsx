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
  formatTimeAgo,
  sideTone,
  toneForOutcome,
  textForOutcome,
} from "@/lib/format";

export default function SignalsPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/signals?page=${page}&limit=50`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [page]);

  return (
    <PageShell
      title="Signals"
      subtitle="Signal inspector and decision traces"
    >
      {loading || !data ? (
        <div className="text-text-dim">Loading signals...</div>
      ) : (
        <Panel
          title="All Signals"
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
                key: "time",
                header: "Time",
                cell: (r: any) => (
                  <span className="text-text-dim">
                    {formatTimeAgo(r.created_at)}
                  </span>
                ),
              },
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
                key: "strategy",
                header: "Strategy",
                cell: (r: any) => (
                  <span className="text-text-dim">{r.strategy_id}</span>
                ),
              },
              {
                key: "entry",
                header: "Entry",
                align: "right",
                cell: (r: any) => formatPrice(r.entry_price, r.symbol),
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
                key: "status",
                header: "Status",
                cell: (r: any) => (
                  <Badge
                    tone={
                      r.status === "filled"
                        ? "long"
                        : r.status === "closed"
                        ? "info"
                        : r.status === "rejected"
                        ? "short"
                        : "muted"
                    }
                    variant="soft"
                  >
                    {r.status}
                  </Badge>
                ),
              },
              {
                key: "outcome",
                header: "Outcome",
                cell: (r: any) =>
                  r.outcome ? (
                    <Badge tone={toneForOutcome(r.outcome)} variant="soft">
                      {textForOutcome(r.outcome)}
                    </Badge>
                  ) : (
                    <span className="text-text-dim">—</span>
                  ),
              },
              {
                key: "r",
                header: "R",
                align: "right",
                cell: (r: any) =>
                  r.outcome_r != null ? (
                    <span
                      className={
                        r.outcome_r >= 0 ? "text-long" : "text-short"
                      }
                    >
                      {formatR(r.outcome_r)}
                    </span>
                  ) : (
                    <span className="text-text-dim">—</span>
                  ),
              },
            ]}
            rows={data.signals}
            keyExtractor={(r) => r.id}
            emptyText="No signals yet"
          />
        </Panel>
      )}
    </PageShell>
  );
}
