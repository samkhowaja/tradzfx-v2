import { NextRequest } from "next/server";
import { getPool, timeBucket, type TimeFrame } from "@tm/shared";
import { fetchAnalyzeSnapshot } from "@/lib/analyzeSnapshot";
import { subscribe, type StreamEvent } from "@/lib/analyzeStreamBus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TFS: TimeFrame[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

// Throttling configuration
const SETUP_MIN_INTERVAL_MS = 5_000;
const SETUP_CONFIDENCE_THRESHOLD = 5;
const PING_INTERVAL_MS = 15_000;

function currentTfBucket(tf: TimeFrame): Date {
  return timeBucket(Date.now(), tf);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? "EURUSD";
  let tfParam = searchParams.get("tf") ?? "1m";
  if (tfParam === "1D") tfParam = "1d";
  const tf = VALID_TFS.includes(tfParam as TimeFrame) ? (tfParam as TimeFrame) : "1m";

  const pool = getPool();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastGrade: string | null = null;
      let lastConfidence = 0;
      let lastSetupTs: string | null = null;
      let lastTfBucket = currentTfBucket(tf);
      let lastSetupComputeAt = 0;

      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const pushSetupIfNeeded = (setup: any) => {
        const grade = setup?.grade ?? null;
        const confidence = setup?.confidence ?? 0;
        const ts = setup?.timestamp ?? null;
        const changed =
          grade !== lastGrade ||
          Math.abs(confidence - lastConfidence) >= SETUP_CONFIDENCE_THRESHOLD ||
          ts !== lastSetupTs;
        if (!changed) return;
        lastGrade = grade;
        lastConfidence = confidence;
        lastSetupTs = ts;
        sendEvent("setup", setup);
      };

      const maybeRecomputeSetup = async () => {
        const now = Date.now();
        if (now - lastSetupComputeAt < SETUP_MIN_INTERVAL_MS) return;
        const bucket = currentTfBucket(tf);
        const bucketChanged = bucket.getTime() !== lastTfBucket.getTime();
        if (!bucketChanged && lastSetupComputeAt > 0) return;
        lastSetupComputeAt = now;
        lastTfBucket = bucket;
        try {
          const fresh = await fetchAnalyzeSnapshot(pool, symbol, tf);
          if (fresh.setup) pushSetupIfNeeded(fresh.setup);
        } catch (err: any) {
          sendEvent("error", { message: err.message });
        }
      };

      try {
        const snapshot = await fetchAnalyzeSnapshot(pool, symbol, tf);
        sendEvent("snapshot", snapshot);
        if (snapshot.status === "stale") {
          sendEvent("status", {
            status: "stale",
            candles: snapshot.freshness.candles,
            now: snapshot.freshness.now,
            reason: "candle data is older than 10 minutes",
          });
        }
        if (snapshot.setup) {
          lastGrade = snapshot.setup.grade ?? null;
          lastConfidence = snapshot.setup.confidence ?? 0;
          lastSetupTs = snapshot.setup.timestamp ?? null;
        }
      } catch (err: any) {
        sendEvent("error", { message: err.message });
      }

      const unsubscribeTf = subscribe(symbol, tf, (event: StreamEvent) => {
        if (event.type === "feature") {
          sendEvent("feature", {
            featureName: event.featureName,
            ts: event.ts,
          });
        } else if (event.type === "setup") {
          pushSetupIfNeeded(event.setup);
        }
      });

      const unsubscribe1m = subscribe(symbol, "1m", (event: StreamEvent) => {
        if (event.type === "candle") {
          sendEvent("candle", event.candle);
          maybeRecomputeSetup().catch((err: any) => {
            sendEvent("error", { message: err.message });
          });
        }
      });

      const heartbeat = setInterval(() => {
        sendEvent("ping", { now: new Date().toISOString() });
        maybeRecomputeSetup().catch((err: any) => {
          sendEvent("error", { message: err.message });
        });
      }, PING_INTERVAL_MS);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribeTf();
        unsubscribe1m();
        try {
          controller.close();
        } catch {}
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
