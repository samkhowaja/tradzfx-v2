"use client";

import { useState } from "react";

interface VariantCreateFormProps {
  familyId: string;
  onCreated: () => void;
  onCancel: () => void;
}

export function VariantCreateForm({
  familyId,
  onCreated,
  onCancel,
}: VariantCreateFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [symbols, setSymbols] = useState("");
  const [timeframes, setTimeframes] = useState("");
  const [overrides, setOverrides] = useState("{}");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    let parsedOverrides = {};
    try {
      parsedOverrides = overrides ? JSON.parse(overrides) : {};
    } catch {
      setError("Overrides must be valid JSON");
      setSubmitting(false);
      return;
    }

    const payload = {
      name: name.trim() || "New variant",
      description: description.trim(),
      symbols: symbols.split(",").map((s) => s.trim()).filter(Boolean),
      timeframes: timeframes.split(",").map((s) => s.trim()).filter(Boolean),
      overrides: parsedOverrides,
    };

    const res = await fetch(`/api/strategies/${familyId}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to create variant");
      setSubmitting(false);
      return;
    }

    onCreated();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-[11px] font-semibold text-text-dim">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. EURUSD 15m conservative"
          className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none focus:border-brand"
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-text-dim">
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional note"
          className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none focus:border-brand"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-text-dim">
            Symbols
          </label>
          <input
            type="text"
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            placeholder="EURUSD, GBPUSD"
            className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-text-dim">
            Timeframes
          </label>
          <input
            type="text"
            value={timeframes}
            onChange={(e) => setTimeframes(e.target.value)}
            placeholder="15m, 1h"
            className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-text outline-none focus:border-brand"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-text-dim">
          Parameter Overrides (JSON)
        </label>
        <textarea
          value={overrides}
          onChange={(e) => setOverrides(e.target.value)}
          rows={4}
          className="w-full rounded border border-border bg-bg px-2 py-1.5 font-mono text-[11px] text-text outline-none focus:border-brand"
        />
      </div>

      {error && <div className="text-[11px] text-short">{error}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1.5 text-[11px] font-semibold text-text-dim hover:bg-elevated"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-brand px-3 py-1.5 text-[11px] font-semibold text-bg hover:bg-brand-dim disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create Variant"}
        </button>
      </div>
    </form>
  );
}
