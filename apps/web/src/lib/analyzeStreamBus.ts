import { EventEmitter } from "events";
import type { TimeFrame } from "@tm/shared";

export interface CandleEventPayload {
  type: "candle";
  symbol: string;
  tf: TimeFrame;
  candle: { ts: string; o: number; h: number; l: number; c: number; v: number };
}

export interface FeatureEventPayload {
  type: "feature";
  symbol: string;
  tf: TimeFrame;
  featureName: string;
  ts: string;
}

export interface SetupEventPayload {
  type: "setup";
  symbol: string;
  tf: TimeFrame;
  setup: unknown;
}

export type StreamEvent = CandleEventPayload | FeatureEventPayload | SetupEventPayload;

type StreamListener = (event: StreamEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

function channel(symbol: string, tf: TimeFrame) {
  return `analyze:stream:${symbol}:${tf}`;
}

export function subscribe(symbol: string, tf: TimeFrame, listener: StreamListener): () => void {
  const key = channel(symbol, tf);
  emitter.on(key, listener);
  return () => emitter.off(key, listener);
}

export function publish(event: StreamEvent): void {
  emitter.emit(channel(event.symbol, event.tf), event);
}
