// chrome-launch-check.mjs — verify Playwright can launch real Chrome with a
// persistent profile (channel:'chrome'), so restarting the sim service will use
// Chrome for automation instead of Edge.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const profile = join(process.env.TEMP || ".", "nova-chrome-check");
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}

try {
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto("https://example.com", { timeout: 20000 });
  const title = await page.title();
  // Identify the browser build.
  const ua = await page.evaluate(() => navigator.userAgent);
  console.log("LAUNCH OK");
  console.log("  title:", title);
  console.log("  ua:", ua);
  await ctx.close();
  console.log("RESULT: Chrome launches fine");
  process.exit(0);
} catch (e) {
  console.log("LAUNCH FAILED:", e.message);
  console.log("RESULT: Chrome launch failed (service would fall back to Edge)");
  process.exit(1);
}
