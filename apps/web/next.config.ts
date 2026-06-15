import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Silence the "multiple lockfiles" warning by telling Next.js the workspace
  // root is the v2 monorepo, not the legacy V1 root.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async rewrites() {
    return [
      // V1 EA compat: old bar ingest endpoint → V2 unified ingest
      { source: "/api/ingest/mt5/bars", destination: "/api/ingest" },
      // V1 EA compat: heartbeat endpoint
      { source: "/api/ingest/mt5/heartbeat", destination: "/api/ingest/heartbeat" },
      // V1 EA compat: config endpoint
      { source: "/api/ingest/mt5/config", destination: "/api/ingest/config" },
      // V1 EA compat: status endpoint
      { source: "/api/ingest/mt5/status", destination: "/api/ingest/status" },
      // V1 EA compat: work queue endpoint
      { source: "/api/ingest/mt5/work/:path*", destination: "/api/ingest/work/:path*" },
      // V1 EA compat: trade sync endpoint
      { source: "/api/mt5/trades", destination: "/api/mt5/trades-compat" },
      // V1 EA compat: commands endpoint
      { source: "/api/mt5/commands", destination: "/api/mt5/commands-compat" },
      // V1 EA compat: commands ack endpoint
      { source: "/api/mt5/commands/ack", destination: "/api/mt5/commands-ack-compat" },
    ];
  },
};

export default nextConfig;
