"use client";

import { useEffect, useRef } from "react";

export type StreamPatch =
  | { type: "snapshot"; data: any }
  | { type: "candle"; candle: { ts: string; o: number; h: number; l: number; c: number; v: number } }
  | { type: "setup"; setup: any }
  | { type: "feature"; featureName: string; ts: string };

export function useAnalyzeStream(
  symbol: string,
  tf: string,
  enabled: boolean,
  onData: (patch: StreamPatch) => void
) {
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    if (!enabled) return;
    const url = `/api/analyze/stream?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`;
    const es = new EventSource(url);

    es.addEventListener("snapshot", (e) => {
      onDataRef.current({ type: "snapshot", data: JSON.parse(e.data) });
    });
    es.addEventListener("candle", (e) => {
      onDataRef.current({ type: "candle", candle: JSON.parse(e.data) });
    });
    es.addEventListener("setup", (e) => {
      onDataRef.current({ type: "setup", setup: JSON.parse(e.data) });
    });
    es.addEventListener("feature", (e) => {
      const payload = JSON.parse(e.data);
      onDataRef.current({ type: "feature", featureName: payload.featureName, ts: payload.ts });
    });
    es.addEventListener("error", (e) => {
      console.error("[analyze stream] error event", e);
    });

    return () => {
      es.close();
    };
  }, [symbol, tf, enabled]);
}
