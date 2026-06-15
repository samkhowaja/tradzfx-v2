"use client";

import { useState } from "react";

interface NarrativeSection {
  heading: string;
  body: string;
  emoji: string;
  importance: "high" | "medium" | "low";
}

interface GlossaryEntry {
  term: string;
  definition: string;
}

interface KeyLevels {
  entry: number;
  stopLoss: number;
  target: number;
  riskReward: number;
}

interface NarrativeData {
  headline: string;
  verdict: string;
  verdictColor: string;
  sections: NarrativeSection[];
  glossary: GlossaryEntry[];
  keyLevels: KeyLevels | null;
}

export function MarketNarrative({ narrative }: { narrative: NarrativeData | null }) {
  const [showGlossary, setShowGlossary] = useState(false);

  if (!narrative) return null;

  const vs = VERDICT_STYLES[narrative.verdictColor] ?? VERDICT_STYLES.gray;

  return (
    <div className="space-y-4">
      {/* Headline */}
      <h2 className="text-lg font-semibold text-text leading-snug">
        {narrative.headline}
      </h2>

      {/* Verdict banner */}
      <div className={`px-4 py-3 rounded-lg border ${vs.bg} ${vs.border}`}>
        <div className="flex items-start gap-2.5">
          <span className="text-base mt-0.5">{vs.icon}</span>
          <p className={`text-sm ${vs.text} leading-relaxed`}>{narrative.verdict}</p>
        </div>
      </div>

      {/* Key Levels */}
      {narrative.keyLevels && (
        <div className="rounded-lg bg-bg border border-border p-3 space-y-2">
          <h3 className="text-[10px] font-semibold text-text-dim uppercase tracking-wider">
            Key Levels
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <LevelRow label="Entry" value={narrative.keyLevels.entry} color="text-brand" />
            <LevelRow label="Stop Loss" value={narrative.keyLevels.stopLoss} color="text-short" />
            <LevelRow label="Target" value={narrative.keyLevels.target} color="text-long" />
            <LevelRow label="R:R" value={narrative.keyLevels.riskReward} color="text-text" isRatio />
          </div>
        </div>
      )}

      {/* Story sections */}
      <div className="space-y-3">
        {narrative.sections.map((section, idx) => (
          <div key={idx} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm">{section.emoji}</span>
              <h3
                className={`text-sm font-semibold ${
                  section.importance === "high" ? "text-text" : "text-text-muted"
                }`}
              >
                {section.heading}
              </h3>
            </div>
            <p className="text-sm text-text-muted leading-relaxed pl-7">
              {section.body}
            </p>
          </div>
        ))}
      </div>

      {/* Glossary */}
      {narrative.glossary.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowGlossary(!showGlossary)}
            className="text-xs text-text-dim hover:text-text-muted transition-colors flex items-center gap-1.5"
          >
            <svg
              className={`w-3 h-3 transition-transform ${showGlossary ? "rotate-90" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {showGlossary ? "Hide" : "Show"} Glossary ({narrative.glossary.length} terms)
          </button>
          {showGlossary && (
            <div className="mt-2 grid gap-2">
              {narrative.glossary.map((entry, idx) => (
                <div key={idx} className="flex gap-2 text-xs">
                  <span className="font-semibold text-text-muted shrink-0 min-w-[100px]">
                    {entry.term}
                  </span>
                  <span className="text-text-dim">{entry.definition}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LevelRow({
  label,
  value,
  color,
  isRatio,
}: {
  label: string;
  value: number;
  color: string;
  isRatio?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-text-dim">{label}</span>
      <span className={`text-xs font-semibold ${color}`}>
        {isRatio ? `1:${(value ?? 0).toFixed(1)}` : value?.toFixed(5) ?? "—"}
      </span>
    </div>
  );
}

const VERDICT_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  green: { bg: "bg-long/10", border: "border-long/30", text: "text-long", icon: "✅" },
  red: { bg: "bg-short/10", border: "border-short/30", text: "text-short", icon: "🔻" },
  amber: { bg: "bg-warn/10", border: "border-warn/30", text: "text-warn", icon: "⚡" },
  gray: { bg: "bg-text-subtle/10", border: "border-text-subtle/30", text: "text-text-dim", icon: "⏸" },
};
