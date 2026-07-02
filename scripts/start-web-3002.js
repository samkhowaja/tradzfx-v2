/**
 * PM2-friendly launcher for the secondary web instance on port 3002.
 * The web app itself reads its port from package.json scripts (start -p 3002).
 */

const { spawn } = require("child_process");
const path = require("path");

const cwd = path.join(__dirname, "..", "apps", "web");
const child = spawn("pnpm", ["start"], {
  cwd,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error("[start-web-3002] failed:", err.message);
  process.exit(1);
});
