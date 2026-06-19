import { chromium } from "playwright";
import { parseArgs } from "util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    url: { type: "string", default: "http://localhost:3003/analyze?symbol=EURUSD&timeframe=15m" },
    output: { type: "string", default: "/tmp/analyze-screenshot.png" },
    wait: { type: "string", default: "8000" },
  },
  allowPositionals: false,
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto(values.url!, { waitUntil: "networkidle" });
  await page.waitForTimeout(Number(values.wait));
  // select 15m timeframe
  const tf15 = page.locator("button", { hasText: "15m" });
  if (await tf15.count()) await tf15.first().click();
  await page.waitForTimeout(4000);
  // click Liquidity, OB and EQH/EQL toggles if present
  for (const label of [/^Liquidity$/, /^OBs?$/, /^EQH\/EQL$/]) {
    const btn = page.locator("button", { hasText: label });
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(1000);
    }
  }
  const debug = await page.evaluate(() => {
    const obs = (window as any).__debugOrderBlocks;
    return { count: obs?.length, items: obs };
  });
  console.log("__debugOrderBlocks:", JSON.stringify(debug, null, 2));
  await page.screenshot({ path: values.output!, fullPage: false });
  console.log("saved", values.output);
  await browser.close();
})();
